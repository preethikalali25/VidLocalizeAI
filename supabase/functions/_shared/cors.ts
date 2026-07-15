// Shared CORS headers for Edge Functions called directly from the browser
// (create-job). advance-job doesn't need browser CORS (it's only called
// server-side, from create-job and from the pg_cron sweep via pg_net), but
// gets the same headers for consistency and easier manual testing.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
