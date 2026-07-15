import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage } from "../../_shared/supabaseAdmin.ts";
import { synthesizeSpeech } from "../../_shared/tts.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runSynthesizingSpeech(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.translated_text) throw new Error("Missing translated_text going into synthesizing_speech stage");

  const { bytes, contentType } = await synthesizeSpeech(job.translated_text, job.target_language);
  const ext = contentType === "audio/wav" ? "wav" : "mp3";
  const path = `${job.user_id}/${job.id}/tts.${ext}`;
  await uploadToStorage(admin, path, bytes, contentType);

  return {
    status: "generating_avatar",
    progress: 65,
    patch: { tts_storage_path: path },
    logMessage: "Generated translated voice audio.",
  };
}
