import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { uploadToStorage, createSignedUrl } from "../../_shared/supabaseAdmin.ts";
import { compositeVideo, type ReplacementSegment } from "../../_shared/videoUtils.ts";
import type { JobRow, JobSegmentRow, StageResult } from "../types.ts";

// Multi-speaker pipeline only (see Phase 4 plan). Final assembly: splice
// each successfully-processed segment's final clip into the original
// video, whole-stage retry on failure (not partial resume) -- if this
// fails, the whole splice is redone from scratch next attempt, which is
// safe/idempotent since it only ever reads already-finished segment rows.
//
// A single synchronous call to the video-utils container, unlike the
// Replicate steps' create-then-poll pattern -- ffmpeg compositing capped-
// length clips should be well within a normal Edge Function's execution
// time limit, but if this starts timing out in practice, the container's
// contract would need to change to an async start+poll shape like
// Replicate's, matching generating_avatar.ts/lip_syncing.ts's pattern.
export async function runCompositing(admin: SupabaseClient, job: JobRow): Promise<StageResult> {
  if (!job.source_storage_path) throw new Error("Missing source_storage_path going into compositing stage");
  const { data: segments, error } = await admin
    .from("job_segments")
    .select("*")
    .eq("job_id", job.id)
    .order("sequence_index", { ascending: true });
  if (error) throw new Error(`Failed to load segments for compositing: ${error.message}`);

  // Segments that ran out of retries (status "failed") are deliberately
  // excluded here -- per the plan's graceful-degrade philosophy, their
  // time range just keeps the original, untouched footage rather than
  // failing the whole job.
  const ready = ((segments ?? []) as JobSegmentRow[]).filter((s) => s.status === "ready");

  const replacementSegments: ReplacementSegment[] = await Promise.all(
    ready.map(async (s) => {
      if (!s.final_segment_storage_path) throw new Error(`Segment ${s.id} is "ready" but has no final_segment_storage_path`);
      return {
        start_seconds: s.start_seconds,
        end_seconds: s.end_seconds,
        clip_url: await createSignedUrl(admin, s.final_segment_storage_path),
      };
    })
  );

  const sourceVideoUrl = await createSignedUrl(admin, job.source_storage_path);
  const { bytes, contentType } = await compositeVideo(sourceVideoUrl, replacementSegments);

  const path = `${job.user_id}/${job.id}/output.mp4`;
  await uploadToStorage(admin, path, bytes, contentType);

  const failedCount = ((segments ?? []) as JobSegmentRow[]).filter((s) => s.status === "failed").length;
  return {
    status: "complete",
    progress: 100,
    patch: { output_storage_path: path },
    logMessage:
      failedCount > 0
        ? `Video ready for download (${failedCount} segment(s) kept original footage after repeated failures).`
        : "Video ready for download.",
  };
}
