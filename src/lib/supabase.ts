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
//
// Multiple call sites invoke this independently on mount (main.tsx's global
// bootstrap, plus each page that needs a session). Without coordination,
// two concurrent calls can both see "no session yet" and each call
// signInAnonymously(), which creates a NEW anonymous user every time it's
// called -- silently producing two different identities, one of which ends
// up mismatched with data already written under the other (surfacing as a
// confusing RLS violation, not an auth error). Caching the in-flight
// promise makes every concurrent caller await the same sign-in.
let anonymousSessionPromise: ReturnType<typeof signInAnonymouslyOnce> | null = null;

async function signInAnonymouslyOnce() {
  if (!supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("Failed to start anonymous session:", error.message);
    anonymousSessionPromise = null; // allow a retry on next call
    return null;
  }
  return data.session;
}

export function ensureAnonymousSession() {
  if (!supabase) return Promise.resolve(null);
  if (!anonymousSessionPromise) {
    anonymousSessionPromise = signInAnonymouslyOnce();
  }
  return anonymousSessionPromise;
}
