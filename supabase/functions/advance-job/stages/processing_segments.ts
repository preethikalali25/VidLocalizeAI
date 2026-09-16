import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, createSignedUrl, logEvent } from "../../_shared/supabaseAdmin.ts";
import { synthesizeSpeech } from "../../_shared/tts.ts";
import { createFaceSwapPrediction, createLipSyncPrediction, getPrediction, downloadOutput } from "../../_shared/replicate.ts";
import { trimClip } from "../../_shared/videoUtils.ts";
import type { AvatarCategory, JobRow, JobSegmentRow, StageResult } from "../types.ts";

// Multi-speaker pipeline only (see Phase 4 plan). One segment-step per
// tick, same "one tick = one unit of work" philosophy as every other
// stage, just at segment granularity instead of job granularity --
// deliberately not batched, to keep partial-failure handling simple (see
// the plan's v1-cuts reasoning for choosing the fixed-2/3-speaker case
// before generalizing).
const SEGMENT_MAX_RETRIES = 3;

export async function runProcessingSegments(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: pending, error } = await admin
    .from("job_segments")
    .select("*")
    .eq("job_id", job.id)
    .not("status", "in", "(ready,failed)")
    .order("sequence_index", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to load pending segments: ${error.message}`);

  if (!pending || pending.length === 0) {
    return { status: "compositing", progress: 85, logMessage: "All segments processed." };
  }

  const segment = pending[0] as JobSegmentRow;

  try {
    switch (segment.status) {
      case "pending_tts":
        return await processTts(admin, job, segment);
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

  await admin.from("job_segments").update({ tts_storage_path: path, status: "pending_faceswap" }).eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Synthesized segment voice audio.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Synthesized segment voice audio." };
}

async function processFaceSwap(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.faceswap_prediction_id) {
    if (!segment.tts_storage_path) throw new Error("Segment has no tts_storage_path going into face-swap");
    if (!job.source_storage_path) throw new Error("Missing source_storage_path going into face-swap");

    const avatarImageUrl = await speakerAvatarSignedUrl(admin, job, segment);
    const sourceVideoUrl = await createSignedUrl(admin, job.source_storage_path);
    const { bytes, contentType } = await trimClip(sourceVideoUrl, segment.start_seconds, segment.end_seconds);
    const clipPath = `${job.user_id}/${job.id}/segments/${segment.id}/source_clip.mp4`;
    await uploadToStorage(admin, clipPath, bytes, contentType);
    const clipUrl = await createSignedUrl(admin, clipPath);
    const prediction = await createFaceSwapPrediction(clipUrl, avatarImageUrl);

    await admin.from("job_segments").update({ faceswap_prediction_id: prediction.id }).eq("id", segment.id);
    await logEvent(admin, job.id, "processing_segments", "Face swap started for segment.", "info", segment.id);
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Face swap started for segment." };
  }

  const prediction = await getPrediction(segment.faceswap_prediction_id);
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Face-swap prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
  }
  if (prediction.status !== "succeeded") {
    return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Face swap in progress..." };
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error("Face-swap prediction has no output URL");
  const { bytes, contentType } = await downloadOutput(outputUrl);
  const path = `${job.user_id}/${job.id}/segments/${segment.id}/faceswap.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  await admin
    .from("job_segments")
    .update({ faceswap_output_storage_path: path, status: "pending_lipsync" })
    .eq("id", segment.id);
  await logEvent(admin, job.id, "processing_segments", "Face swap complete for segment.", "info", segment.id);
  return { status: "processing_segments", progress: await estimateProgress(admin, job.id), logMessage: "Face swap complete for segment." };
}

async function processLipSync(admin: SupabaseClient, job: JobRow, segment: JobSegmentRow): Promise<StageResult> {
  if (!segment.lipsync_prediction_id) {
    if (!segment.faceswap_output_storage_path || !segment.tts_storage_path) {
      throw new Error("Segment missing faceswap output or tts audio going into lip-sync");
    }

    const videoUrl = await createSignedUrl(admin, segment.faceswap_output_storage_path);
    const audioUrl = await createSignedUrl(admin, segment.tts_storage_path);
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
// terminal per-segment state. Not exact -- segments in flight don't count
// as partial progress -- but good enough for a progress bar.
async function estimateProgress(admin: SupabaseClient, jobId: string): Promise<number> {
  const { count: total } = await admin.from("job_segments").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  const { count: done } = await admin
    .from("job_segments")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", ["ready", "failed"]);
  if (!total) return 55;
  return 55 + Math.round((30 * (done ?? 0)) / total);
}
