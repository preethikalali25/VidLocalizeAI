import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

if (!isSupabaseConfigured) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — real backend features are disabled."
  );
}

// Every job in this app belongs to an anonymous Supabase auth session, which
// exists purely so row-level security can scope each visitor to their own
// jobs — there is no login UI or real account system.
export async function ensureAnonymousSession() {
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("Failed to start anonymous session:", error.message);
    return null;
  }
  return data.session;
}
