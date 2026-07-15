import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getPrediction } from "../../_shared/replicate.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runLipSyncing(_admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.replicate_prediction_id) throw new Error("Missing replicate_prediction_id going into lip_syncing stage");

  const prediction = await getPrediction(job.replicate_prediction_id);

  if (prediction.status === "succeeded") {
    return {
      status: "rendering",
      progress: 90,
      logMessage: "Lip-synced avatar video generated.",
    };
  }
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
  }

  // still "starting" or "processing" -- no status change, just wait for the
  // next cron tick to poll again.
  return {
    status: "lip_syncing",
    progress: 80,
    logMessage: "Lip-syncing in progress...",
  };
}
