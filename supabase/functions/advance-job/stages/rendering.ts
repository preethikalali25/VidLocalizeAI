import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage } from "../../_shared/supabaseAdmin.ts";
import { downloadOutput, getPrediction } from "../../_shared/replicate.ts";
import type { JobRow, StageResult } from "../types.ts";

export async function runRendering(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.replicate_prediction_id) throw new Error("Missing replicate_prediction_id going into rendering stage");

  const prediction = await getPrediction(job.replicate_prediction_id);
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new Error("Replicate prediction has no output URL");

  // Replicate's own output URL is temporary -- copy it into permanent
  // storage so it survives after the prediction record eventually expires.
  const { bytes, contentType } = await downloadOutput(outputUrl);
  const path = `${job.user_id}/${job.id}/output.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  return {
    status: "complete",
    progress: 100,
    patch: { output_storage_path: path },
    logMessage: "Video ready for download.",
  };
}
