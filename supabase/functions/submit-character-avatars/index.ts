import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseForRequest, logEvent } from "../_shared/supabaseAdmin.ts";

// The only thing allowed to move a job out of awaiting_character_avatars --
// mirrors submit-speaker-assignments for the multi_speaker pipeline. The
// cron sweep in advance-job/index.ts explicitly skips this status, so a
// job sits here indefinitely until this function is called.

const ALLOWED_AVATAR_CATEGORIES = ["man", "woman", "boy_child", "girl_child", "old_man", "old_woman"];

interface Assignment {
  character_id: string;
  avatar_category: string;
}

interface SubmitBody {
  job_id: string;
  assignments: Assignment[];
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  if (!body.job_id || !Array.isArray(body.assignments) || body.assignments.length === 0) {
    return badRequest("job_id and a non-empty assignments array are required");
  }
  for (const a of body.assignments) {
    if (!a.character_id || !ALLOWED_AVATAR_CATEGORIES.includes(a.avatar_category)) {
      return badRequest(`each assignment needs a character_id and avatar_category in ${ALLOWED_AVATAR_CATEGORIES.join(", ")}`);
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

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id, user_id, status, pipeline_mode")
    .eq("id", body.job_id)
    .single();
  if (jobError || !job) {
    return new Response(JSON.stringify({ error: "job not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (job.user_id !== userId) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (job.pipeline_mode !== "script_drama" || job.status !== "awaiting_character_avatars") {
    return badRequest(`job is not awaiting character avatars (status: ${job.status})`);
  }

  const { data: characters, error: charactersError } = await admin
    .from("drama_characters")
    .select("id")
    .eq("job_id", body.job_id);
  if (charactersError) {
    return new Response(JSON.stringify({ error: charactersError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const knownCharacterIds: string[] = (characters ?? []).map((c: { id: string }) => c.id);
  const assignedCharacterIds = new Set(body.assignments.map((a) => a.character_id));
  const coversAllCharacters =
    knownCharacterIds.length === assignedCharacterIds.size &&
    knownCharacterIds.every((id: string) => assignedCharacterIds.has(id));
  if (!coversAllCharacters) {
    return badRequest("assignments must cover every detected character for this job, exactly once");
  }

  // Same defensive check as submit-speaker-assignments: fail with a clear
  // error instead of letting the job proceed toward a clip-generation
  // stage that's guaranteed to fail because the chosen category has no
  // uploaded photo.
  const categories = [...new Set(body.assignments.map((a) => a.avatar_category))];
  const { data: photos, error: photosError } = await admin
    .from("avatar_photos")
    .select("category")
    .eq("user_id", userId)
    .in("category", categories);
  if (photosError) {
    return new Response(JSON.stringify({ error: photosError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const uploadedCategories = new Set((photos ?? []).map((p: { category: string }) => p.category));
  const missing = categories.filter((c) => !uploadedCategories.has(c));
  if (missing.length > 0) {
    return badRequest(`No avatar photo uploaded for: ${missing.join(", ")} -- upload on the Avatars page first`);
  }

  for (const a of body.assignments) {
    const { error: updateError } = await admin
      .from("drama_characters")
      .update({ avatar_category: a.avatar_category })
      .eq("id", a.character_id);
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  await admin
    .from("jobs")
    .update({ status: "translating_lines", last_advanced_at: new Date().toISOString() })
    .eq("id", body.job_id);
  await logEvent(admin, body.job_id, "translating_lines", "Character avatars assigned, resuming processing.", "info");

  // Same fire-and-forget kick pattern as submit-speaker-assignments, so
  // the pipeline doesn't sit idle until the next ~20s cron tick.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  fetch(`${supabaseUrl}/functions/v1/advance-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: body.job_id }),
  }).catch((err) => console.error("Failed to kick advance-job:", err));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
