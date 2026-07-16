import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createSignedUrl } from "../../_shared/supabaseAdmin.ts";
import { createAvatarPrediction, getPrediction } from "../../_shared/replicate.ts";
import type { JobRow, StageResult } from "../types.ts";

async function avatarPhotoSignedUrl(admin: SupabaseClient, job: JobRow): Promise<string> {
  const { data: photo, error } = await admin
    .from("avatar_photos")
    .select("storage_path")
    .eq("user_id", job.user_id)
    .eq("category", job.avatar_category)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up avatar photo: ${error.message}`);
  // Shouldn't happen -- create-job checks this exists before creating the
  // job -- but the photo could theoretically be removed/replaced between
  // job creation and this stage running.
  if (!photo) throw new Error(`No avatar photo found for category "${job.avatar_category}"`);
  return createSignedUrl(admin, photo.storage_path);
}

export async function runGeneratingAvatar(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.replicate_prediction_id) {
    if (!job.tts_storage_path) throw new Error("Missing tts_storage_path going into generating_avatar stage");

    const audioUrl = await createSignedUrl(admin, job.tts_storage_path);
    const imageUrl = await avatarPhotoSignedUrl(admin, job);
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
