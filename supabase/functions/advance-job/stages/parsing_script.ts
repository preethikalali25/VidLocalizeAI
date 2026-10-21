import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseScript } from "../../_shared/gemini.ts";
import type { AvatarCategory, JobRow, StageResult } from "../types.ts";

// Fallback when Gemini's text-based category guess comes back null (no
// clear signal in the script) -- any category is fine as a starting
// point for a uniquely-generated avatar (see generating_character_
// avatars.ts), unlike the multi_speaker pipeline where a wrong voice-
// category guess costs real TTS/swap money before anyone notices. The
// explicit ask here was zero manual steps, not precision.
const DEFAULT_CATEGORY: AvatarCategory = "woman";

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
    const { characters, lines } = await parseScript(job.script_text);

    const characterIds = new Map<string, string>();
    for (const character of characters) {
      const category = character.suggested_category ?? DEFAULT_CATEGORY;
      const { data: charRow, error: charError } = await admin
        .from("drama_characters")
        .insert({
          job_id: job.id,
          name: character.name,
          suggested_avatar_category: character.suggested_category,
          // Always set, never left for a human to pick -- a unique photo
          // gets generated per character next regardless of category, so
          // there's no cost to committing to a guess here the way there
          // was for multi_speaker's voice-driven categories.
          avatar_category: category,
        })
        .select("id")
        .single();
      if (charError || !charRow) {
        throw new Error(`Failed to save character "${character.name}": ${charError?.message ?? "no row returned"}`);
      }
      characterIds.set(character.name, charRow.id);
    }

    const lineRows = lines
      .filter((line) => characterIds.has(line.character_name))
      .map((line, index) => ({
        job_id: job.id,
        character_id: characterIds.get(line.character_name) as string,
        sequence_index: index,
        source_text: line.text,
      }));
    const { error: linesError } = await admin.from("drama_lines").insert(lineRows);
    if (linesError) throw new Error(`Failed to save script lines: ${linesError.message}`);
  }

  return {
    status: "generating_character_avatars",
    progress: 35,
    logMessage: "Parsed script -- generating a unique AI avatar for each character.",
  };
}
