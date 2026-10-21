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
    const { characters, lines } = await parseScript(job.script_text);

    // Auto-assign (skip the human review pause) only when EVERY character
    // has a confident suggestion with an uploaded photo for it -- same
    // trade-off and reasoning as diarizing.ts's canAutoAssign for the
    // multi_speaker pipeline, just driven by the script's text/names
    // instead of voice pitch.
    const { data: photoRows, error: photoError } = await admin
      .from("avatar_photos")
      .select("category")
      .eq("user_id", job.user_id);
    if (photoError) throw new Error(`Failed to check avatar photos: ${photoError.message}`);
    const uploadedCategories = new Set((photoRows ?? []).map((p: { category: string }) => p.category));
    const canAutoAssign =
      characters.length > 0 &&
      characters.every((c) => c.suggested_category && uploadedCategories.has(c.suggested_category));

    const characterIds = new Map<string, string>();
    for (const character of characters) {
      const { data: charRow, error: charError } = await admin
        .from("drama_characters")
        .insert({
          job_id: job.id,
          name: character.name,
          suggested_avatar_category: character.suggested_category,
          avatar_category: canAutoAssign ? character.suggested_category : null,
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

  // Re-derived fresh from the DB rather than the in-memory computation
  // above, so this is correct on an idempotent retry too (existing
  // already non-empty, insert skipped entirely) -- same pattern as
  // diarizing.ts.
  const { data: allCharacters, error: allCharactersError } = await admin
    .from("drama_characters")
    .select("avatar_category")
    .eq("job_id", job.id);
  if (allCharactersError) throw new Error(`Failed to check character assignments: ${allCharactersError.message}`);
  const autoAssigned =
    (allCharacters ?? []).length > 0 &&
    (allCharacters ?? []).every((c: { avatar_category: string | null }) => c.avatar_category);

  if (autoAssigned) {
    return {
      status: "translating_lines",
      progress: 45,
      logMessage: "Parsed script and auto-assigned avatars -- every character had a confident suggestion with a matching photo.",
    };
  }

  return {
    status: "awaiting_character_avatars",
    progress: 30,
    logMessage: "Parsed script -- waiting for you to assign avatars to each character.",
  };
}
