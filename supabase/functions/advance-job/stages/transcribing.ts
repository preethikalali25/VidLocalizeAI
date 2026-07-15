import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { transcribeVideo } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runTranscribing(_admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.gemini_file_uri) throw new Error("Missing gemini_file_uri going into transcribing stage");

  const transcript = await transcribeVideo(
    job.gemini_file_uri,
    job.source_mime_type ?? "video/mp4",
    job.source_lang
  );

  return {
    status: "translating",
    progress: 40,
    patch: { transcript_text: transcript },
    logMessage: `Transcribed ${transcript.length} characters.`,
  };
}
