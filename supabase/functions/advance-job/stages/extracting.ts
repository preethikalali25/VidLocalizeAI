import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { downloadFromStorage } from "../../_shared/supabaseAdmin.ts";
import { uploadFileToGemini } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

// No ffmpeg involved -- Gemini consumes the video's audio track directly
// from the uploaded file, so "extracting" here means "hand the video to
// Gemini's Files API and wait for it to become ACTIVE," not literal audio
// separation.
export async function runExtracting(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.source_storage_path) throw new Error("Missing source_storage_path going into extracting stage");
  const { bytes, contentType } = await downloadFromStorage(admin, job.source_storage_path);
  const fileUri = await uploadFileToGemini(bytes, contentType, job.source_file_name ?? job.title);

  // multi_speaker jobs skip the single flat transcript entirely -- diarizing
  // does per-speaker transcription+segmentation in one structured call.
  const nextStatus = job.pipeline_mode === "multi_speaker" ? "diarizing" : "transcribing";

  return {
    status: nextStatus,
    progress: 25,
    patch: { gemini_file_uri: fileUri, source_mime_type: contentType },
    logMessage: "Video prepared for AI processing.",
  };
}
