import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getSupabaseAdmin, logEvent } from "../_shared/supabaseAdmin.ts";
import type { JobRow, JobStatus, StageResult } from "./types.ts";
import { runValidating } from "./stages/validating.ts";
import { runExtracting } from "./stages/extracting.ts";
import { runTranscribing } from "./stages/transcribing.ts";
import { runTranslating } from "./stages/translating.ts";
import { runSynthesizingSpeech } from "./stages/synthesizing_speech.ts";
import { runGeneratingAvatar } from "./stages/generating_avatar.ts";
import { runLipSyncing } from "./stages/lip_syncing.ts";
import { runRendering } from "./stages/rendering.ts";
import { runDiarizing } from "./stages/diarizing.ts";
import { runProcessingSegments } from "./stages/processing_segments.ts";
import { runCompositing } from "./stages/compositing.ts";
import { runFetchingSource } from "./stages/fetching_source.ts";
import { runParsingScript } from "./stages/parsing_script.ts";
import { runTranslatingLines } from "./stages/translating_lines.ts";
import { runGeneratingClips } from "./stages/generating_clips.ts";
import { runAssemblingVideo } from "./stages/assembling_video.ts";

const MAX_RETRIES = 3;
// Must stay comfortably above the longest bound any single stage call can
// legitimately take -- video-utils calls are now capped at 90s (180s for
// fetch-youtube, see videoUtils.ts), so this needs real headroom above
// that. Too short and a still-running (not dead) call gets its job
// re-claimed and re-run in parallel by the next sweep -- confirmed live,
// this was the actual cause of the video-utils container getting hit by
// several concurrent compositing calls at once and OOM-crashing.
const STALE_AFTER_SECONDS = 240;
const MAX_JOBS_PER_SWEEP = 5;

// deno-lint-ignore no-explicit-any
type Admin = any;

// awaiting_speaker_review and awaiting_character_avatars are deliberately
// excluded: they're the statuses that never auto-advance on a tick. Only
// submit-speaker-assignments / submit-character-avatars are allowed to
// move a job out of either one.
const STAGE_HANDLERS: Record<
  Exclude<JobStatus, "complete" | "error" | "awaiting_speaker_review" | "awaiting_character_avatars">,
  (admin: Admin, job: JobRow) => Promise<StageResult>
> = {
  validating: runValidating,
  extracting: runExtracting,
  transcribing: runTranscribing,
  translating: runTranslating,
  synthesizing_speech: runSynthesizingSpeech,
  generating_avatar: runGeneratingAvatar,
  lip_syncing: runLipSyncing,
  rendering: runRendering,
  diarizing: runDiarizing,
  processing_segments: runProcessingSegments,
  compositing: runCompositing,
  fetching_source: runFetchingSource,
  parsing_script: runParsingScript,
  translating_lines: runTranslatingLines,
  generating_clips: runGeneratingClips,
  assembling_video: runAssemblingVideo,
};

async function advanceOneJob(admin: Admin, job: JobRow): Promise<void> {
  const handler = STAGE_HANDLERS[job.status as keyof typeof STAGE_HANDLERS];
  if (!handler) {
    console.error(`No stage handler for status "${job.status}" (job ${job.id})`);
    return;
  }

  // Claim the job before doing any real work, via an optimistic-lock
  // update that only succeeds if last_advanced_at still matches what we
  // just read it as. Without this, last_advanced_at was only ever written
  // AFTER the handler finished -- but a single handler call (a Replicate
  // poll, a Gemini TTS/transcription call) routinely outlives
  // STALE_AFTER_SECONDS, so a second concurrent sweep (or the direct
  // create-job kick racing the cron) would see the same job as "stale"
  // and run the SAME stage a second time in parallel. Confirmed live: a
  // real job's event log came in duplicate pairs ~1s apart for its entire
  // run, double-paying for every Replicate/Gemini call and corrupting
  // whichever concurrent write lost the race on a segment row.
  const { data: claimed, error: claimError } = await admin
    .from("jobs")
    .update({ last_advanced_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("last_advanced_at", job.last_advanced_at)
    .select("id");
  if (claimError) {
    console.error(`Failed to claim job ${job.id}: ${claimError.message}`);
    return;
  }
  if (!claimed || claimed.length === 0) {
    // Lost the race -- another invocation already claimed this tick.
    return;
  }

  try {
    const result = await handler(admin, job);
    await admin
      .from("jobs")
      .update({
        status: result.status,
        progress: result.progress,
        last_advanced_at: new Date().toISOString(),
        ...(result.status === "complete" ? { completed_at: new Date().toISOString() } : {}),
        ...(result.patch ?? {}),
      })
      .eq("id", job.id);
    await logEvent(admin, job.id, result.status, result.logMessage, "info");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextRetryCount = job.retry_count + 1;
    const giveUp = nextRetryCount >= MAX_RETRIES;

    await admin
      .from("jobs")
      .update({
        retry_count: nextRetryCount,
        last_advanced_at: new Date().toISOString(),
        ...(giveUp ? { status: "error", error_message: message } : {}),
      })
      .eq("id", job.id);
    await logEvent(
      admin,
      job.id,
      job.status,
      giveUp
        ? `Failed after ${nextRetryCount} attempts: ${message}`
        : `Attempt ${nextRetryCount} failed, will retry: ${message}`,
      "error"
    );
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const admin = getSupabaseAdmin();

  let jobId: string | undefined;
  try {
    const body = await req.json();
    jobId = body?.job_id;
  } catch {
    // empty body is valid -- it's how the pg_cron sweep calls this function
  }

  if (jobId) {
    const { data: job, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) {
      return new Response(JSON.stringify({ error: "job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await advanceOneJob(admin, job as JobRow);
    return new Response(JSON.stringify({ advanced: 1 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cron sweep: pick up any non-terminal, auto-advanceable job that hasn't
  // been touched recently (avoids double-processing a job that's already
  // mid-tick from the direct create-job kick). awaiting_speaker_review is
  // excluded on purpose -- it's paused for human input, not stalled; only
  // submit-speaker-assignments is allowed to move it forward.
  const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("*")
    .not("status", "in", "(complete,error,awaiting_speaker_review,awaiting_character_avatars)")
    .lt("last_advanced_at", staleCutoff)
    .order("last_advanced_at", { ascending: true })
    .limit(MAX_JOBS_PER_SWEEP);

  if (error) {
    console.error("Sweep query failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const job of (jobs ?? []) as JobRow[]) {
    await advanceOneJob(admin, job);
  }

  return new Response(JSON.stringify({ advanced: jobs?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
