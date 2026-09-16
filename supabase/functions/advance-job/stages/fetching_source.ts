import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage } from "../../_shared/supabaseAdmin.ts";
import { fetchYoutubeVideo } from "../../_shared/videoUtils.ts";
import type { JobRow, StageResult } from "../types.ts";

// input_method === "youtube" only. Direct uploads already have
// source_storage_path set at job-creation time (the browser uploads
// straight to Storage before create-job is even called); YouTube jobs
// don't, so this stage runs first to download the video and populate it,
// then hands off to validating exactly like an upload would from there.
export async function runFetchingSource(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.source_youtube_url) throw new Error("Missing source_youtube_url going into fetching_source stage");

  // Not set here -- the video-utils container already rejects anything
  // over the duration cap before downloading (see its /fetch-youtube
  // handler), so there's nothing left to enforce by the time this
  // returns. validating.ts's own duration check is a no-op when
  // source_duration_seconds is null, which is fine: enforcement already
  // happened, just earlier than usual.
  const { bytes, contentType } = await fetchYoutubeVideo(job.source_youtube_url);

  const path = `${job.user_id}/${job.id}/source.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  return {
    status: "validating",
    progress: 8,
    patch: { source_storage_path: path, source_mime_type: contentType },
    logMessage: "Downloaded video from YouTube.",
  };
}
