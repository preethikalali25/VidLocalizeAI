import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, createSignedUrl } from "../../_shared/supabaseAdmin.ts";
import { concatClips } from "../../_shared/videoUtils.ts";
import type { DramaLineRow, JobRow, StageResult } from "../types.ts";

// script_drama pipeline only. Final assembly: stitch every successfully-
// generated line clip together in script order -- no splicing into a
// source video (there isn't one), just concatenation. A line that ran out
// of retries (status "failed") is simply skipped, same graceful-degrade
// philosophy as the rest of this pipeline, rather than failing the whole
// job over one bad line.
export async function runAssemblingVideo(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  const { data: lines, error } = await admin
    .from("drama_lines")
    .select("*")
    .eq("job_id", job.id)
    .order("sequence_index", { ascending: true });
  if (error) throw new Error(`Failed to load lines for assembly: ${error.message}`);

  const all = (lines ?? []) as DramaLineRow[];
  const readyLines = all.filter((l) => l.status === "ready");
  if (readyLines.length === 0) throw new Error("No lines succeeded -- nothing to assemble");

  const clipUrls = await Promise.all(
    readyLines.map(async (l) => {
      if (!l.clip_storage_path) throw new Error(`Line ${l.id} is "ready" but has no clip_storage_path`);
      return createSignedUrl(admin, l.clip_storage_path);
    })
  );

  const { bytes, contentType } = await concatClips(clipUrls);
  const path = `${job.user_id}/${job.id}/output.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  const failedCount = all.filter((l) => l.status === "failed").length;
  return {
    status: "complete",
    progress: 100,
    patch: { output_storage_path: path },
    logMessage:
      failedCount > 0
        ? `Video ready for download (${failedCount} line(s) skipped after repeated failures).`
        : "Video ready for download.",
  };
}
