import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { translateText, translateSegments } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runTranslating(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (job.pipeline_mode === "multi_speaker") return runTranslatingMultiSpeaker(admin, job);

  if (!job.transcript_text) throw new Error("Missing transcript_text going into translating stage");

  const translated = await translateText(job.transcript_text, job.target_language);

  return {
    status: "synthesizing_speech",
    progress: 55,
    patch: { translated_text: translated },
    logMessage: `Translated to ${job.target_language}.`,
  };
}

async function runTranslatingMultiSpeaker(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: segments, error } = await admin
    .from("job_segments")
    .select("id, source_text")
    .eq("job_id", job.id)
    .order("sequence_index", { ascending: true });
  if (error) throw new Error(`Failed to load segments: ${error.message}`);
  if (!segments || segments.length === 0) throw new Error("No segments found going into translating stage");

  // Idempotency guard, same reasoning as diarizing.ts: a retry re-entering
  // this stage after a partial prior attempt shouldn't call Gemini and
  // re-translate segments that already have a translation.
  const { data: alreadyTranslated } = await admin
    .from("job_segments")
    .select("id")
    .eq("job_id", job.id)
    .not("translated_text", "is", null)
    .limit(1);

  if (!alreadyTranslated || alreadyTranslated.length === 0) {
    const texts = segments.map((s: { source_text: string | null }) => s.source_text ?? "");
    const translations = await translateSegments(texts, job.target_language);

    await Promise.all(
      segments.map((s: { id: string }, i: number) =>
        admin.from("job_segments").update({ translated_text: translations[i] }).eq("id", s.id)
      )
    );
  }

  return {
    status: "processing_segments",
    progress: 55,
    logMessage: `Translated ${segments.length} segment(s) to ${job.target_language}.`,
  };
}
