import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, createSignedUrl, logEvent } from "../../_shared/supabaseAdmin.ts";
import { synthesizeSpeech } from "../../_shared/tts.ts";
import { createAvatarPrediction, getPrediction, downloadOutput } from "../../_shared/replicate.ts";
import type { AvatarCategory, DramaLineRow, JobRow, StageResult } from "../types.ts";

// script_drama pipeline only. One line-step per tick, same "one tick =
// one unit of work" philosophy as processing_segments.ts, just simpler --
// every line gets its own clip (no face-swap, no block-merging across a
// speaker's silent stretches, since there's no source footage at all to
// bridge gaps in).
const LINE_MAX_RETRIES = 3;

export async function runGeneratingClips(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: pending, error } = await admin
    .from("drama_lines")
    .select("*")
    .eq("job_id", job.id)
    .not("status", "in", "(ready,failed)")
    .order("sequence_index", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to load pending lines: ${error.message}`);

  if (!pending || pending.length === 0) {
    return { status: "assembling_video", progress: 90, logMessage: "All lines processed." };
  }

  const line = pending[0] as DramaLineRow;

  try {
    switch (line.status) {
      case "pending_tts":
        return await processLineTts(admin, job, line);
      case "pending_clip":
        return await processLineClip(admin, job, line);
      default:
        throw new Error(`Unexpected line status "${line.status}"`);
    }
  } catch (err) {
    return await handleLineError(admin, job, line, err);
  }
}

// One failed line doesn't fail the whole job -- same graceful-degrade
// philosophy as processing_segments.ts -- a line that runs out of
// retries just gets skipped from the final concatenated video rather
// than failing the whole job.
async function handleLineError(admin: SupabaseClient, job: JobRow, line: DramaLineRow, err: unknown): Promise<StageResult> {
  const message = err instanceof Error ? err.message : String(err);
  const nextRetryCount = line.retry_count + 1;
  const giveUp = nextRetryCount >= LINE_MAX_RETRIES;

  await admin
    .from("drama_lines")
    .update({
      retry_count: nextRetryCount,
      ...(giveUp ? { status: "failed", error_message: message } : {}),
    })
    .eq("id", line.id);

  await logEvent(
    admin,
    job.id,
    "generating_clips",
    giveUp
      ? `Line failed after ${nextRetryCount} attempts, will be skipped in the final video: ${message}`
      : `Line attempt ${nextRetryCount} failed, will retry: ${message}`,
    "error"
  );

  return { status: "generating_clips", progress: job.progress, logMessage: "Clip generation continues." };
}

async function characterAvatarCategory(admin: SupabaseClient, characterId: string): Promise<AvatarCategory | null> {
  const { data: character, error } = await admin
    .from("drama_characters")
    .select("avatar_category")
    .eq("id", characterId)
    .single();
  if (error || !character) throw new Error(`Failed to look up character: ${error?.message ?? "not found"}`);
  return character.avatar_category as AvatarCategory | null;
}

async function characterAvatarSignedUrl(admin: SupabaseClient, job: JobRow, category: AvatarCategory): Promise<string> {
  const { data: photo, error } = await admin
    .from("avatar_photos")
    .select("storage_path")
    .eq("user_id", job.user_id)
    .eq("category", category)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up avatar photo: ${error.message}`);
  if (!photo) throw new Error(`No avatar photo found for category "${category}"`);
  return createSignedUrl(admin, photo.storage_path);
}

async function processLineTts(admin: SupabaseClient, job: JobRow, line: DramaLineRow): Promise<StageResult> {
  if (!line.translated_text) throw new Error("Line has no translated_text");

  const avatarCategory = await characterAvatarCategory(admin, line.character_id);
  const { bytes, contentType } = await synthesizeSpeech(line.translated_text, job.target_language, avatarCategory);
  const ext = contentType === "audio/wav" ? "wav" : "mp3";
  const path = `${job.user_id}/${job.id}/lines/${line.id}/tts.${ext}`;
  await uploadToStorage(admin, path, bytes, contentType);

  await admin.from("drama_lines").update({ tts_storage_path: path, status: "pending_clip" }).eq("id", line.id);
  await logEvent(admin, job.id, "generating_clips", "Synthesized line voice audio.", "info");
  return { status: "generating_clips", progress: await estimateProgress(admin, job.id), logMessage: "Synthesized line voice audio." };
}

async function processLineClip(admin: SupabaseClient, job: JobRow, line: DramaLineRow): Promise<StageResult> {
  if (!line.replicate_prediction_id) {
    if (!line.tts_storage_path) throw new Error("Line has no tts_storage_path going into clip generation");

    const avatarCategory = await characterAvatarCategory(admin, line.character_id);
    if (!avatarCategory) throw new Error("Character has no avatar_category assigned yet");
    const avatarImageUrl = await characterAvatarSignedUrl(admin, job, avatarCategory);
    const audioUrl = await createSignedUrl(admin, line.tts_storage_path);
    const prediction = await createAvatarPrediction(avatarImageUrl, audioUrl);

    await admin.from("drama_lines").update({ replicate_prediction_id: prediction.id }).eq("id", line.id);
    await logEvent(admin, job.id, "generating_clips", "Clip generation started for line.", "info");
    return { status: "generating_clips", progress: await estimateProgress(admin, job.id), logMessage: "Clip generation started for line." };
  }

  const prediction = await getPrediction(line.replicate_prediction_id);
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Clip generation prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
  }
  if (prediction.status !== "succeeded") {
    return { status: "generating_clips", progress: await estimateProgress(admin, job.id), logMessage: "Clip generation in progress..." };
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error("Clip generation prediction has no output URL");
  const { bytes, contentType } = await downloadOutput(outputUrl);
  const path = `${job.user_id}/${job.id}/lines/${line.id}/clip.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  await admin.from("drama_lines").update({ clip_storage_path: path, status: "ready" }).eq("id", line.id);
  await logEvent(admin, job.id, "generating_clips", "Line ready.", "info");
  return { status: "generating_clips", progress: await estimateProgress(admin, job.id), logMessage: "Line ready." };
}

// Rough progress estimate across the 45 (end of translating_lines) - 90
// (start of assembling_video) range, same approach as
// processing_segments.ts's estimateProgress.
async function estimateProgress(admin: SupabaseClient, jobId: string): Promise<number> {
  const { count: total } = await admin.from("drama_lines").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  const { count: done } = await admin
    .from("drama_lines")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", ["ready", "failed"]);
  if (!total) return 45;
  return 45 + Math.round((45 * (done ?? 0)) / total);
}
