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

const MAX_RETRIES = 3;
const STALE_AFTER_SECONDS = 15;
const MAX_JOBS_PER_SWEEP = 5;

// deno-lint-ignore no-explicit-any
type Admin = any;

const STAGE_HANDLERS: Record<
  Exclude<JobStatus, "complete" | "error">,
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
};

async function advanceOneJob(admin: Admin, job: JobRow): Promise<void> {
  const handler = STAGE_HANDLERS[job.status as keyof typeof STAGE_HANDLERS];
  if (!handler) {
    console.error(`No stage handler for status "${job.status}" (job ${job.id})`);
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

  // Cron sweep: pick up any non-terminal job that hasn't been touched
  // recently (avoids double-processing a job that's already mid-tick from
  // the direct create-job kick).
  const staleCutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("*")
    .not("status", "in", "(complete,error)")
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
