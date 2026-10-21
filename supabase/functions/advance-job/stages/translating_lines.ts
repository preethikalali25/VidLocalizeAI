import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { translateSegments } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runTranslatingLines(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: lines, error } = await admin
    .from("drama_lines")
    .select("id, source_text")
    .eq("job_id", job.id)
    .order("sequence_index", { ascending: true });
  if (error) throw new Error(`Failed to load script lines: ${error.message}`);
  if (!lines || lines.length === 0) throw new Error("No script lines found going into translating_lines stage");

  // Idempotency guard, same pattern as translating.ts's multi_speaker path.
  const { data: alreadyTranslated } = await admin
    .from("drama_lines")
    .select("id")
    .eq("job_id", job.id)
    .not("translated_text", "is", null)
    .limit(1);

  if (!alreadyTranslated || alreadyTranslated.length === 0) {
    const texts = lines.map((l: { source_text: string }) => l.source_text);
    const translations = await translateSegments(texts, job.target_language);
    await Promise.all(
      lines.map((l: { id: string }, i: number) =>
        admin.from("drama_lines").update({ translated_text: translations[i] }).eq("id", l.id)
      )
    );
  }

  return {
    status: "generating_clips",
    progress: 45,
    logMessage: `Translated ${lines.length} line(s) to ${job.target_language}.`,
  };
}
