import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseForRequest } from "../_shared/supabaseAdmin.ts";

const ALLOWED_TARGET_LANGUAGES = ["hindi", "telugu", "tamil", "kannada", "bengali"];
const ALLOWED_AVATAR_CATEGORIES = ["man", "woman", "boy_child", "girl_child", "old_man", "old_woman"];
const MAX_UPLOAD_DURATION_SECONDS = 180;
const MAX_UPLOAD_SIZE_MB = 300;
const MAX_JOBS_PER_HOUR = 10;

interface CreateJobBody {
  title: string;
  sourceLang: string;
  targetLanguage: string;
  pipelineMode?: string;
  avatarCategory?: string;
  inputMethod?: string;
  sourceStoragePath?: string;
  sourceYoutubeUrl?: string;
  sourceFileName?: string;
  sourceDurationSeconds?: number;
  sourceSizeBytes?: number;
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isYoutubeUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return /(^|\.)(youtube\.com|youtu\.be)$/.test(hostname);
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: CreateJobBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  if (!body.title || !body.sourceLang) {
    return badRequest("title and sourceLang are required");
  }
  if (!ALLOWED_TARGET_LANGUAGES.includes(body.targetLanguage)) {
    return badRequest(`targetLanguage must be one of ${ALLOWED_TARGET_LANGUAGES.join(", ")}`);
  }

  const inputMethod = body.inputMethod === "youtube" ? "youtube" : "upload";
  if (inputMethod === "upload" && !body.sourceStoragePath) {
    return badRequest("sourceStoragePath is required for upload jobs");
  }
  if (inputMethod === "youtube" && (!body.sourceYoutubeUrl || !isYoutubeUrl(body.sourceYoutubeUrl))) {
    return badRequest("sourceYoutubeUrl is required and must be a youtube.com/youtu.be URL");
  }

  const pipelineMode = body.pipelineMode === "multi_speaker" ? "multi_speaker" : "single_avatar";
  if (pipelineMode === "single_avatar" && !ALLOWED_AVATAR_CATEGORIES.includes(body.avatarCategory ?? "")) {
    return badRequest(`avatarCategory must be one of ${ALLOWED_AVATAR_CATEGORIES.join(", ")}`);
  }
  // Duration/size are only known upfront for direct uploads (the browser
  // read them before calling this function) -- youtube jobs are checked
  // server-side instead, by the video-utils container before it downloads
  // anything (see fetching_source.ts / video-utils-container/server.js).
  if (inputMethod === "upload") {
    if (body.sourceDurationSeconds && body.sourceDurationSeconds > MAX_UPLOAD_DURATION_SECONDS) {
      return badRequest(`video duration exceeds the ${MAX_UPLOAD_DURATION_SECONDS}s v1 cap`);
    }
    if (body.sourceSizeBytes && body.sourceSizeBytes > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      return badRequest(`video size exceeds the ${MAX_UPLOAD_SIZE_MB}MB v1 cap`);
    }
  }

  const userClient = getSupabaseForRequest(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  const admin = getSupabaseAdmin();

  // Fail fast with a clear message instead of creating a job that's
  // guaranteed to fail three stages later at generating_avatar. Skipped
  // for multi_speaker jobs -- no category is chosen at creation time, this
  // same check happens per-speaker instead in submit-speaker-assignments.
  if (pipelineMode === "single_avatar") {
    const { data: avatarPhoto, error: avatarPhotoError } = await admin
      .from("avatar_photos")
      .select("category")
      .eq("user_id", userId)
      .eq("category", body.avatarCategory)
      .maybeSingle();
    if (avatarPhotoError) {
      return new Response(JSON.stringify({ error: avatarPhotoError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!avatarPhoto) {
      return badRequest(`No avatar photo uploaded for "${body.avatarCategory}" -- upload one on the Avatars page first`);
    }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  if (countError) {
    return new Response(JSON.stringify({ error: countError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if ((count ?? 0) >= MAX_JOBS_PER_HOUR) {
    return new Response(JSON.stringify({ error: "rate limit exceeded, try again later" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Insert via the user-scoped client so RLS's `jobs_insert_own` policy
  // (auth.uid() = user_id) enforces ownership naturally.
  const { data: job, error: insertError } = await userClient
    .from("jobs")
    .insert({
      user_id: userId,
      title: body.title,
      source_lang: body.sourceLang,
      target_language: body.targetLanguage,
      pipeline_mode: pipelineMode,
      avatar_category: pipelineMode === "single_avatar" ? body.avatarCategory : null,
      input_method: inputMethod,
      // fetching_source (youtube jobs only) populates source_storage_path
      // itself once it downloads the video -- null here is intentional,
      // not a bug, same as it starting null for multi_speaker's
      // avatar_category.
      status: inputMethod === "youtube" ? "fetching_source" : "validating",
      source_storage_path: inputMethod === "upload" ? body.sourceStoragePath : null,
      source_youtube_url: inputMethod === "youtube" ? body.sourceYoutubeUrl : null,
      source_file_name: body.sourceFileName ?? null,
      source_duration_seconds: body.sourceDurationSeconds ?? null,
      source_size_bytes: body.sourceSizeBytes ?? null,
    })
    .select("id")
    .single();

  if (insertError || !job) {
    return new Response(JSON.stringify({ error: insertError?.message ?? "insert failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Kick the first pipeline step immediately rather than waiting for the
  // next ~20s cron tick. Fire-and-forget: don't make the caller wait for an
  // entire pipeline step (which can involve a slow Gemini call) just to get
  // back a job id.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  fetch(`${supabaseUrl}/functions/v1/advance-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: job.id }),
  }).catch((err) => console.error("Failed to kick advance-job:", err));

  return new Response(JSON.stringify({ id: job.id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
