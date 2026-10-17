import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, createSignedUrl, logEvent } from "../../_shared/supabaseAdmin.ts";
import { synthesizeSpeech } from "../../_shared/tts.ts";
import { createPersonSwapPrediction, createLipSyncPrediction, getPrediction, downloadOutput } from "../../_shared/replicate.ts";
import { trimClip, stitchAudio } from "../../_shared/videoUtils.ts";
import type { AvatarCategory, JobRow, JobSegmentRow, StageResult } from "../types.ts";

// Multi-speaker pipeline only (see Phase 4 plan). One segment-step per
// tick, same "one tick = one unit of work" philosophy as every other
// stage, just at segment granularity instead of job granularity --
// deliberately not batched, to keep partial-failure handling simple (see
// the plan's v1-cuts reasoning for choosing the fixed-2/3-speaker case
// before generalizing).
const SEGMENT_MAX_RETRIES = 3;

export async function runProcessingSegments(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  // "merged" segments are excluded alongside ready/failed -- a follower
  // has nothing left to do once its own TTS lands, see processTts below.
  const { data: candidates, error } = await admin
    .from("job_segments")
    .select("*")
    .eq("job_id", job.id)
    .not("status", "in", "(ready,failed,merged)")
    .order("sequence_index", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Failed to load pending segments: ${error.message}`);

  if (!candidates || candidates.length === 0) {
    return { status: "compositing", progress: 85, logMessage: "All segments processed." };
  }

  const segment = await pickActionableSegment(admin, candidates as JobSegmentRow[]);
  if (!segment) {
    // Every remaining candidate is a block leader waiting on followers
    // that haven't finished their own TTS yet -- expected, the next tick
    // (once a follower's own processTts runs) unblocks it. A leader
    // always has the lowest sequence_index in its own block, so a plain
    // "earliest non-terminal segment" pick would otherwise keep
    // re-selecting a waiting leader forever instead of its followers.
    return { status: "processing_segments", progress: job.progress, logMessage: "Waiting on segment audio before merging speaking blocks." };
  }

  try {
    switch (segment.status) {
      case "pending_tts":
        return await processTts(admin, job, segment);
      case "awaiting_followers":
        return await processAwaitingFollowers(admin, job, segment);
      case "pending_faceswap":
        return await processFaceSwap(admin, job, segment);
      case "pending_lipsync":
        return await processLipSync(admin, job, segment);
      default:
        throw new Error(`Unexpected segment status "${segment.status}"`);
    }
  } catch (err) {
    return await handleSegmentError(admin, job, segment, err);
  }
}

async function pickActionableSegment(admin: SupabaseClient, candidates: JobSegmentRow[]): Promise<JobSegmentRow | null> {
  for (const candidate of candidates) {
    if (candidate.status !== "awaiting_followers") return candidate;
    if (await allFollowersSettled(admin, candidate.id)) return candidate;
  }
  return null;
}

// "Settled" means either done (merged) or given up (failed) -- either way
// there's nothing more to wait for. Only "pending_tts" (still actively
// retrying) blocks the leader from proceeding.
async function allFollowersSettled(admin: SupabaseClient, leaderId: string): Promise<boolean> {
  const { data: stillPending, error } = await admin
    .from("job_segments")
    .select("id")
    .eq("block_leader_id", leaderId)
    .eq("status", "pending_tts")
    .limit(1);
  if (error) throw new Error(`Failed to check block followers: ${error.message}`);
  return !stillPending || stillPending.length === 0;
}

// One failed segment doesn't fail the whole job -- per the plan's
// graceful-degrade philosophy, a segment that runs out of retries just
// stays "failed" and keeps the original footage for its time range during
// compositing. Retry accounting lives on the segment row, not the job
// row, so this deliberately never re-throws to index.ts's job-level
// catch (which would burn the job's own retry_count for one bad segment).
async function handleSegmentError(
  admin: SupabaseClient,
  job: JobRow,
  segment: JobSegmentRow,
  err: unknown
): Promise<StageResult> {
  const message = err instanceof Error ? err.message : String(err);
  const nextRetryCount = segment.retry_count + 1;
  const giveUp = nextRetryCount >= SEGMENT_MAX_RETRIES;

  await admin
    .from("job_segments")
    .update({
      retry_count: nextRetryCount,
      ...(giveUp ? { status: "failed", error_message: message } : {}),
    })
    .eq("id", segment.id);

  await logEvent(
    admin,
    job.id,
    "processing_segments",
    giveUp
      ? `Segment failed after ${nextRetryCount} attempts, original footage will be kept for this range: ${message}`
      : `Segment attempt ${nextRetryCount} failed, will retry: ${message}`,
    "error",
    segment.id
  );

  return { status: "processing_segments", progress: job.progress, logMessage: "Segment processing continues." };
}

async function processTts(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.translated_text) throw new Error("Segment has no translated_text");

  const { bytes, contentType } = await synthesizeSpeech(segment.translated_text, job.target_language);
  const ext = contentType === "audio/wav" ? "wav" : "mp3";
  const path = `${job.user_id}/${job.id}/segments/${segment.id}/tts.${ext}`;
  await uploadToStorage(admin, path, bytes, contentType);

  // A follower (block_leader_id set) is done the moment its own TTS
  // lands -- its audio gets folded into the leader's stitched track by
  // processAwaitingFollowers. A leader (block_leader_id null, whether
  // solo or heading a multi-segment block) waits for its followers next.
  const isFollower = segment.block_leader_id !== null;
  const nextStatus = isFollower ? "merged" : "awaiting_followers";

  await admin.from("job_segments").update({ tts_storage_path: path, status: nextStatus }).eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Synthesized segment voice audio.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Synthesized segment voice audio." };
}

// A block leader's own TTS is done and every follower in its block has
// settled (see allFollowersSettled). For a solo block (no followers) the
// leader's own TTS already covers its whole range, nothing to stitch. For
// a multi-segment block, builds one continuous audio track spanning the
// block's full extended range -- translated speech during each
// settled-and-successful sub-segment's own window, original (untouched)
// audio everywhere else, including any sub-segment whose own TTS
// ultimately failed (graceful degrade: that one moment just keeps the
// original audio rather than blocking the whole block).
async function processAwaitingFollowers(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.tts_storage_path) throw new Error("Block leader has no tts_storage_path");

  const { data: followers, error: followersError } = await admin
    .from("job_segments")
    .select("start_seconds, end_seconds, tts_storage_path, status")
    .eq("block_leader_id", segment.id);
  if (followersError) throw new Error(`Failed to load block followers: ${followersError.message}`);

  const usableFollowers = ((followers ?? []) as { start_seconds: number; end_seconds: number; tts_storage_path: string | null; status: string }[])
    .filter((f) => f.status === "merged" && f.tts_storage_path);

  let stitchedPath: string;
  if (usableFollowers.length === 0) {
    stitchedPath = segment.tts_storage_path;
  } else {
    if (!job.source_storage_path) throw new Error("Missing source_storage_path going into audio stitching");
    const blockStart = segment.block_start_seconds ?? segment.start_seconds;
    const blockEnd = segment.block_end_seconds ?? segment.end_seconds;

    const overlaySegments = [
      { start_seconds: segment.start_seconds, end_seconds: segment.end_seconds, tts_storage_path: segment.tts_storage_path },
      ...usableFollowers,
    ];
    const overlays = await Promise.all(
      overlaySegments.map(async (seg) => ({
        start_seconds: seg.start_seconds,
        end_seconds: seg.end_seconds,
        audio_url: await createSignedUrl(admin, seg.tts_storage_path as string),
      }))
    );

    const sourceVideoUrl = await createSignedUrl(admin, job.source_storage_path);
    const { bytes, contentType } = await stitchAudio(sourceVideoUrl, blockStart, blockEnd, overlays);
    stitchedPath = `${job.user_id}/${job.id}/segments/${segment.id}/stitched_audio.wav`;
    await uploadToStorage(admin, stitchedPath, bytes, contentType);
  }

  await admin
    .from("job_segments")
    .update({ stitched_audio_storage_path: stitchedPath, status: "pending_faceswap" })
    .eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Merged segment audio for this speaking block.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Merged segment audio for this speaking block." };
}

async function processFaceSwap(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.faceswap_prediction_id) {
    if (!segment.stitched_audio_storage_path) throw new Error("Segment has no stitched_audio_storage_path going into person swap");
    if (!job.source_storage_path) throw new Error("Missing source_storage_path going into person swap");

    const avatarImageUrl = await speakerAvatarSignedUrl(admin, job, segment);
    const sourceVideoUrl = await createSignedUrl(admin, job.source_storage_path);
    // The block's full extended range, not the leader's own literal
    // start/end -- this is what actually keeps the swapped face on
    // screen through the speaker's silent stretches.
    const blockStart = segment.block_start_seconds ?? segment.start_seconds;
    const blockEnd = segment.block_end_seconds ?? segment.end_seconds;
    const { bytes, contentType } = await trimClip(sourceVideoUrl, blockStart, blockEnd);
    const clipPath = `${job.user_id}/${job.id}/segments/${segment.id}/source_clip.mp4`;
    await uploadToStorage(admin, clipPath, bytes, contentType);
    const clipUrl = await createSignedUrl(admin, clipPath);
    const prediction = await createPersonSwapPrediction(clipUrl, avatarImageUrl);

    await admin.from("job_segments").update({ faceswap_prediction_id: prediction.id }).eq("id", segment.id);
    await logEvent(admin, job.id, "processing_segments", "Person swap started for segment.", "info", segment.id);
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Person swap started for segment." };
  }

  const prediction = await getPrediction(segment.faceswap_prediction_id);
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Person swap prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
  }
  if (prediction.status !== "succeeded") {
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Person swap in progress..." };
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error("Person swap prediction has no output URL");
  const { bytes, contentType } = await downloadOutput(outputUrl);
  const path = `${job.user_id}/${job.id}/segments/${segment.id}/faceswap.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  await admin
    .from("job_segments")
    .update({ faceswap_output_storage_path: path, status: "pending_lipsync" })
    .eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Person swap complete for segment.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Person swap complete for segment." };
}

async function processLipSync(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.lipsync_prediction_id) {
    if (!segment.faceswap_output_storage_path || !segment.stitched_audio_storage_path) {
      throw new Error("Segment missing faceswap output or stitched audio going into lip-sync");
    }

    const videoUrl = await createSignedUrl(admin, segment.faceswap_output_storage_path);
    const audioUrl = await createSignedUrl(admin, segment.stitched_audio_storage_path);
    const prediction = await createLipSyncPrediction(videoUrl, audioUrl);

    await admin.from("job_segments").update({ lipsync_prediction_id: prediction.id }).eq("id", segment.id);
    await logEvent(admin, job.id, "processing_segments", "Lip-sync started for segment.", "info", segment.id);
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Lip-sync started for segment." };
  }

  const prediction = await getPrediction(segment.lipsync_prediction_id);
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Lip-sync prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
  }
  if (prediction.status !== "succeeded") {
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Lip-sync in progress..." };
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error("Lip-sync prediction has no output URL");
  const { bytes, contentType } = await downloadOutput(outputUrl);
  const path = `${job.user_id}/${job.id}/segments/${segment.id}/final.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  await admin.from("job_segments").update({ final_segment_storage_path: path, status: "ready" }).eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Segment ready.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Segment ready." };
}

async function speakerAvatarSignedUrl(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<string> {
  const { data: speaker, error: speakerError } = await admin
    .from("job_speakers")
    .select("avatar_category")
    .eq("id", segment.speaker_id)
    .single();
  if (speakerError || !speaker) throw new Error(`Failed to look up speaker: ${speakerError?.message ?? "not found"}`);
  const category: AvatarCategory | null = speaker.avatar_category;
  if (!category) throw new Error("Speaker has no avatar_category assigned yet");

  const { data: photo, error: photoError } = await admin
    .from("avatar_photos")
    .select("storage_path")
    .eq("user_id", job.user_id)
    .eq("category", category)
    .maybeSingle();
  if (photoError) throw new Error(`Failed to look up avatar photo: ${photoError.message}`);
  if (!photo) throw new Error(`No avatar photo found for category "${category}"`);
  return createSignedUrl(admin, photo.storage_path);
}

// Rough progress estimate across the 55 (end of translating) - 85 (start
// of compositing) range, proportional to segments that have reached a
// terminal-for-this-row state. "merged" counts as done here too -- a
// follower never reaches ready/failed itself, its fate is folded into its
// leader's block. Not exact -- segments in flight don't count as partial
// progress -- but good enough for a progress bar.
async function estimateProgress(admin: SupabaseClient, jobId: string): Promise<number> {
  const { count: total } = await admin.from("job_segments").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  const { count: done } = await admin
    .from("job_segments")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", ["ready", "failed", "merged"]);
  if (!total) return 55;
  return 55 + Math.round((30 * (done ?? 0)) / total);
}
