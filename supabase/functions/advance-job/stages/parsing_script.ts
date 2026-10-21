import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseScript } from "../../_shared/gemini.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runParsingScript(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.script_text) throw new Error("Missing script_text going into parsing_script stage");

  // Idempotency guard, same pattern as diarizing.ts -- a retry re-entering
  // this stage after a prior attempt already inserted rows shouldn't call
  // Gemini and insert duplicates.
  const { data: existing, error: existingError } = await admin
    .from("drama_characters")
    .select("id")
    .eq("job_id", job.id)
    .limit(1);
  if (existingError) throw new Error(`Failed to check for existing characters: ${existingError.message}`);

  if (!existing || existing.length === 0) {
    const lines = await parseScript(job.script_text);

    const characterIds = new Map<string, string>();
    for (const line of lines) {
      if (characterIds.has(line.character_name)) continue;
      const { data: charRow, error: charError } = await admin
        .from("drama_characters")
        .insert({ job_id: job.id, name: line.character_name })
        .select("id")
        .single();
      if (charError || !charRow) {
        throw new Error(`Failed to save character "${line.character_name}": ${charError?.message ?? "no row returned"}`);
      }
      characterIds.set(line.character_name, charRow.id);
    }

    const lineRows = lines.map((line, index) => ({
      job_id: job.id,
      character_id: characterIds.get(line.character_name) as string,
      sequence_index: index,
      source_text: line.text,
    }));
    const { error: linesError } = await admin.from("drama_lines").insert(lineRows);
    if (linesError) throw new Error(`Failed to save script lines: ${linesError.message}`);
  }

  return {
    status: "awaiting_character_avatars",
    progress: 30,
    logMessage: "Parsed script -- waiting for you to assign avatars to each character.",
  };
}
