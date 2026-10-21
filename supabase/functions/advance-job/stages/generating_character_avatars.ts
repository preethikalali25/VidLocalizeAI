import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, logEvent } from "../../_shared/supabaseAdmin.ts";
import { createAvatarImagePrediction, getPrediction } from "../../_shared/replicate.ts";
import type { AvatarCategory, DramaCharacterRow, JobRow, StageResult } from "../types.ts";

// script_drama pipeline only. Generates one unique AI avatar photo per
// character -- not the user's shared avatar_photos library, so two
// characters assigned the same category (e.g. two "man" roles) don't end
// up looking identical. One character per tick, same create-then-poll-
// across-ticks shape as every other Replicate call in this pipeline.
//
// A character whose generation keeps failing is skipped after a few
// retries (avatar_storage_path stays null) rather than blocking the
// whole job -- same graceful-degrade philosophy as everywhere else in
// this pipeline. generating_clips.ts falls back to the shared
// avatar_photos category lookup for that one character.
const AVATAR_MAX_RETRIES = 3;

const CATEGORY_PROMPT: Record<AvatarCategory, string> = {
  man: "a man",
  woman: "a woman",
  boy_child: "a young boy",
  girl_child: "a young girl",
  old_man: "an elderly man",
  old_woman: "an elderly woman",
};

// Same wording as generate-avatar-photo/index.ts -- keeping every
// generated character fictional, never a real identifiable person.
const GUARDRAIL_SUFFIX =
  ", photorealistic portrait photo, facing camera, plain neutral background, shoulders-up framing. " +
  "Generate a fictional, generic-looking person only -- do not depict any real, identifiable public " +
  "figure, celebrity, politician, or other named individual.";

export async function runGeneratingCharacterAvatars(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: pending, error } = await admin
    .from("drama_characters")
    .select("*")
    .eq("job_id", job.id)
    .is("avatar_storage_path", null)
    .lt("avatar_retry_count", AVATAR_MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to load characters needing avatars: ${error.message}`);

  if (!pending || pending.length === 0) {
    return { status: "translating_lines", progress: 45, logMessage: "Finished generating character avatars." };
  }

  const character = pending[0] as DramaCharacterRow;

  try {
    if (!character.avatar_prediction_id) {
      const category = character.avatar_category ?? "woman";
      const prediction = await createAvatarImagePrediction(`${CATEGORY_PROMPT[category]}${GUARDRAIL_SUFFIX}`);
      await admin.from("drama_characters").update({ avatar_prediction_id: prediction.id }).eq("id", character.id);
      await logEvent(admin, job.id, "generating_character_avatars", `Generating avatar for "${character.name}".`, "info");
      return {
        status: "generating_character_avatars",
        progress: await estimateProgress(admin, job.id),
        logMessage: `Generating avatar for "${character.name}".`,
      };
    }

    const prediction = await getPrediction(character.avatar_prediction_id);
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`Avatar image prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
    }
    if (prediction.status !== "succeeded") {
      return {
        status: "generating_character_avatars",
        progress: await estimateProgress(admin, job.id),
        logMessage: `Avatar for "${character.name}" still generating...`,
      };
    }

    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) throw new Error("Avatar image prediction has no output URL");
    const imageRes = await fetch(outputUrl);
    if (!imageRes.ok) throw new Error(`Failed to download generated avatar: ${imageRes.status}`);
    const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await imageRes.arrayBuffer());
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `${job.user_id}/${job.id}/characters/${character.id}/avatar.${ext}`;
    await uploadToStorage(admin, path, bytes, contentType);

    await admin.from("drama_characters").update({ avatar_storage_path: path }).eq("id", character.id);
    await logEvent(admin, job.id, "generating_character_avatars", `Avatar ready for "${character.name}".`, "info");
    return {
      status: "generating_character_avatars",
      progress: await estimateProgress(admin, job.id),
      logMessage: `Avatar ready for "${character.name}".`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextRetryCount = character.avatar_retry_count + 1;
    const giveUp = nextRetryCount >= AVATAR_MAX_RETRIES;

    await admin
      .from("drama_characters")
      // Clear avatar_prediction_id on every failure (not just give-up) so
      // a retry starts a fresh prediction rather than re-polling a dead one.
      .update({ avatar_retry_count: nextRetryCount, avatar_prediction_id: null })
      .eq("id", character.id);

    await logEvent(
      admin,
      job.id,
      "generating_character_avatars",
      giveUp
        ? `Avatar generation failed for "${character.name}" after ${nextRetryCount} attempts -- will reuse your uploaded ${character.avatar_category ?? ""} photo instead: ${message}`
        : `Avatar attempt ${nextRetryCount} failed for "${character.name}", will retry: ${message}`,
      "error"
    );

    return { status: "generating_character_avatars", progress: job.progress, logMessage: "Character avatar generation continues." };
  }
}

async function estimateProgress(admin: SupabaseClient, jobId: string): Promise<number> {
  const { count: total } = await admin.from("drama_characters").select("id", { count: "exact", head: true }).eq("job_id", jobId);
  const { count: done } = await admin
    .from("drama_characters")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .not("avatar_storage_path", "is", null);
  if (!total) return 35;
  return 35 + Math.round((10 * (done ?? 0)) / total);
}
