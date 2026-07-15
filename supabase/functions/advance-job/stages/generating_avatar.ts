import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createSignedUrl } from "../../_shared/supabaseAdmin.ts";
import { createAvatarPrediction, getPrediction } from "../../_shared/replicate.ts";
import type { JobRow, StageResult } from "../types.ts";

// PUBLIC_AVATAR_BASE_URL must point at the deployed site's public
// public/avatars/ folder, e.g. "https://<user>.github.io/VidLocalizeAI/avatars"
// -- Replicate needs to fetch this image from the open internet, so it
// can't be a relative path or localhost URL. Set as an Edge Function secret.
function avatarImageUrl(gender: "male" | "female"): string {
  const base = Deno.env.get("PUBLIC_AVATAR_BASE_URL");
  if (!base) throw new Error("PUBLIC_AVATAR_BASE_URL is not set");
  return `${base.replace(/\/$/, "")}/avatar-${gender}.jpg`;
}

export async function runGeneratingAvatar(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.replicate_prediction_id) {
    if (!job.tts_storage_path) throw new Error("Missing tts_storage_path going into generating_avatar stage");

    const audioUrl = await createSignedUrl(admin, job.tts_storage_path);
    const imageUrl = avatarImageUrl(job.avatar_gender);
    const prediction = await createAvatarPrediction(imageUrl, audioUrl);

    return {
      status: "generating_avatar",
      progress: 70,
      patch: { replicate_prediction_id: prediction.id },
      logMessage: `Avatar generation started (prediction ${prediction.id}).`,
    };
  }

  const prediction = await getPrediction(job.replicate_prediction_id);
  if (prediction.status === "starting") {
    return {
      status: "generating_avatar",
      progress: 70,
      logMessage: "Waiting for avatar generation to start processing...",
    };
  }

  // Once it's left "starting" (processing, succeeded, or failed), hand off
  // to the lip_syncing stage, which owns polling through to a terminal state.
  return {
    status: "lip_syncing",
    progress: 75,
    logMessage: "Avatar generation is processing.",
  };
}
