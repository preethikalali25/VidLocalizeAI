// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function by Supabase -- you do NOT need to set these yourself with
// `supabase secrets set`. Only the AI vendor keys (GEMINI_API_KEY,
// REPLICATE_API_TOKEN, etc.) need to be set manually.
export function getSupabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in this function's environment");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Client scoped to the calling user's own JWT, so RLS applies naturally --
// used only by create-job, which must insert as the requesting user rather
// than as service_role.
export function getSupabaseForRequest(req: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not available in this function's environment");
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const JOB_ASSETS_BUCKET = "job-assets";

export async function downloadFromStorage(
  admin: SupabaseClient,
  path: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { data, error } = await admin.storage.from(JOB_ASSETS_BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Failed to download ${path} from storage: ${error?.message ?? "no data"}`);
  }
  const contentType = data.type || "application/octet-stream";
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, contentType };
}

export async function uploadToStorage(
  admin: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const { error } = await admin.storage
    .from(JOB_ASSETS_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    throw new Error(`Failed to upload ${path} to storage: ${error.message}`);
  }
}

// Replicate needs a public HTTPS URL it can fetch from outside Supabase, so
// TTS audio bound for the avatar-generation step gets a time-boxed signed
// URL rather than requiring the bucket to be public.
export async function createSignedUrl(
  admin: SupabaseClient,
  path: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await admin.storage
    .from(JOB_ASSETS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Failed to sign URL for ${path}: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}

export async function logEvent(
  admin: SupabaseClient,
  jobId: string,
  stage: string,
  message: string,
  level: "info" | "error" = "info"
): Promise<void> {
  await admin.from("job_events").insert({ job_id: jobId, stage, level, message });
}
