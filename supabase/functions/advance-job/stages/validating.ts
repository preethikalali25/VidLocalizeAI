import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { JOB_ASSETS_BUCKET } from "../../_shared/supabaseAdmin.ts";
import type { JobRow, StageResult } from "../types.ts";

const MAX_UPLOAD_DURATION_SECONDS = 180;
const MAX_UPLOAD_SIZE_MB = 300;

// Client-side already checks duration/size before upload (NewJobPage.tsx),
// but that's trivially bypassable -- this is the real, enforced check.
export async function runValidating(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const folder = job.source_storage_path.substring(0, job.source_storage_path.lastIndexOf("/"));
  const fileName = job.source_storage_path.substring(job.source_storage_path.lastIndexOf("/") + 1);

  const { data: listing, error } = await admin.storage.from(JOB_ASSETS_BUCKET).list(folder);
  if (error) throw new Error(`Storage list failed: ${error.message}`);

  const object = listing?.find((f) => f.name === fileName);
  if (!object) {
    throw new Error(`Uploaded file not found at ${job.source_storage_path}`);
  }

  if (job.source_duration_seconds && job.source_duration_seconds > MAX_UPLOAD_DURATION_SECONDS) {
    throw new Error(
      `Video duration ${job.source_duration_seconds}s exceeds the ${MAX_UPLOAD_DURATION_SECONDS}s v1 cap`
    );
  }
  const sizeMb = (object.metadata?.size ?? 0) / (1024 * 1024);
  if (sizeMb > MAX_UPLOAD_SIZE_MB) {
    throw new Error(`Video size ${sizeMb.toFixed(1)}MB exceeds the ${MAX_UPLOAD_SIZE_MB}MB v1 cap`);
  }

  return {
    status: "extracting",
    progress: 10,
    logMessage: "Source video validated.",
  };
}
