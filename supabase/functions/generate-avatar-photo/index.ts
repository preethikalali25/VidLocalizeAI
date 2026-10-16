import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";
import { getSupabaseAdmin, getSupabaseForRequest, uploadToStorage, JOB_ASSETS_BUCKET } from "../_shared/supabaseAdmin.ts";
import { createAvatarImagePrediction, getPrediction } from "../_shared/replicate.ts";

// Alternative to uploading a real photo on the Avatars page: describe a
// person in a text box instead, and flux-schnell generates one to use in
// that same avatar_photos/category slot. Deliberately scoped to generic
// descriptions only ("a young Indian woman") rather than real named
// individuals ("Shah Rukh Khan") -- generating a photorealistic likeness
// of a real, identifiable public figure and then face/body-swapping them
// into arbitrary video content is a deepfake/impersonation risk, not just
// a quality one, so GUARDRAIL_SUFFIX below is appended to every prompt
// telling the model to keep the result fictional/generic. This is a
// best-effort nudge (via the model's own instruction-following), not a
// hard technical block -- there's no reliable way to catch every way a
// real individual's name/description could be phrased.
const ALLOWED_AVATAR_CATEGORIES = ["man", "woman", "boy_child", "girl_child", "old_man", "old_woman"];
const MAX_PROMPT_LENGTH = 300;
const PREDICTION_POLL_TIMEOUT_MS = 30_000;
const PREDICTION_POLL_INTERVAL_MS = 1_000;

const GUARDRAIL_SUFFIX =
  ", photorealistic portrait photo, facing camera, plain neutral background, shoulders-up framing. " +
  "Generate a fictional, generic-looking person only -- do not depict any real, identifiable public " +
  "figure, celebrity, politician, or other named individual.";

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

async function waitForPrediction(id: string): Promise<{ output: string | string[] | null }> {
  const deadline = Date.now() + PREDICTION_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const prediction = await getPrediction(id);
    if (prediction.status === "succeeded") return prediction;
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(`Avatar image prediction ${prediction.status}: ${prediction.error ?? "no error detail"}`);
    }
    await new Promise((r) => setTimeout(r, PREDICTION_POLL_INTERVAL_MS));
  }
  throw new Error(`Avatar image generation did not finish within ${PREDICTION_POLL_TIMEOUT_MS / 1000}s`);
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("method not allowed", 405);
  }

  let body: { category?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const category = body.category ?? "";
  const prompt = (body.prompt ?? "").trim();
  if (!ALLOWED_AVATAR_CATEGORIES.includes(category)) {
    return badRequest(`category must be one of: ${ALLOWED_AVATAR_CATEGORIES.join(", ")}`);
  }
  if (!prompt) {
    return badRequest("prompt is required");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return badRequest(`prompt is too long -- max ${MAX_PROMPT_LENGTH} characters`);
  }

  const userClient = getSupabaseForRequest(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return errorResponse("unauthenticated", 401);
  }
  const userId = userData.user.id;

  try {
    const prediction = await createAvatarImagePrediction(prompt + GUARDRAIL_SUFFIX);
    const { output } = await waitForPrediction(prediction.id);
    const outputUrl = Array.isArray(output) ? output[0] : output;
    if (!outputUrl) throw new Error("Avatar image prediction has no output URL");

    const imageRes = await fetch(outputUrl);
    if (!imageRes.ok) throw new Error(`Failed to download generated image: ${imageRes.status}`);
    const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
    const bytes = new Uint8Array(await imageRes.arrayBuffer());
    const ext = extForContentType(contentType);
    const path = `${userId}/avatars/${category}.${ext}`;

    const admin = getSupabaseAdmin();
    await uploadToStorage(admin, path, bytes, contentType);

    // Same "extension can change between saves" cleanup the frontend does
    // on a manual re-upload -- upsert alone can't remove a now-orphaned
    // object under the old extension's key.
    const { data: existing } = await admin
      .from("avatar_photos")
      .select("storage_path")
      .eq("user_id", userId)
      .eq("category", category)
      .maybeSingle();
    const { error: upsertError } = await admin
      .from("avatar_photos")
      .upsert({ user_id: userId, category, storage_path: path }, { onConflict: "user_id,category" });
    if (upsertError) throw new Error(`Failed to save avatar photo record: ${upsertError.message}`);
    if (existing?.storage_path && existing.storage_path !== path) {
      await admin.storage.from(JOB_ASSETS_BUCKET).remove([existing.storage_path]);
    }

    return new Response(JSON.stringify({ storage_path: path }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message);
  }
});
