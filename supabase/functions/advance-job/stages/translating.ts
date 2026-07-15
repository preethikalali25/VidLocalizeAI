import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { translateText } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runTranslating(_admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.transcript_text) throw new Error("Missing transcript_text going into translating stage");

  const translated = await translateText(job.transcript_text, job.target_language);

  return {
    status: "synthesizing_speech",
    progress: 55,
    patch: { translated_text: translated },
    logMessage: `Translated to ${job.target_language}.`,
  };
}
