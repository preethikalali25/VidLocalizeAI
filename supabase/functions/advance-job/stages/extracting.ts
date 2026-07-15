import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { downloadFromStorage } from "../../_shared/supabaseAdmin.ts";
import { uploadFileToGemini } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

// No ffmpeg involved -- Gemini consumes the video's audio track directly
// from the uploaded file, so "extracting" here means "hand the video to
// Gemini's Files API and wait for it to become ACTIVE," not literal audio
// separation.
export async function runExtracting(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { bytes, contentType } = await downloadFromStorage(admin, job.source_storage_path);
  const fileUri = await uploadFileToGemini(bytes, contentType, job.source_file_name ?? job.title);

  return {
    status: "transcribing",
    progress: 25,
    patch: { gemini_file_uri: fileUri, source_mime_type: contentType },
    logMessage: "Video prepared for AI processing.",
  };
}
