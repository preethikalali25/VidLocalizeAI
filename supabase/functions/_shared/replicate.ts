// Avatar generation + lip-sync via Replicate.
//
// Model: lucataco/sadtalker (single portrait image + audio -> talking head
// video). This is a community model, not one of Replicate's "official"
// models, so it doesn't support the /models/{owner}/{name}/predictions
// shortcut (that 404s) -- it needs the classic /v1/predictions endpoint
// with an explicit pinned version. If predictions start failing with a
// 404/"not found" again, get the current version hash from the "HTTP" tab
// under https://replicate.com/lucataco/sadtalker/api and update
// REPLICATE_MODEL_VERSION below.
const REPLICATE_MODEL_VERSION = "85c698db7c0a66d5011435d0191db323034e1da04b912a6d365833141b6a285b";
const REPLICATE_API_BASE = "https://api.replicate.com/v1";

function apiToken(): string {
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  return token;
}

export interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: string | string[] | null;
  error: string | null;
}

export async function createAvatarPrediction(
  sourceImageUrl: string,
  drivenAudioUrl: string
): Promise<ReplicatePrediction> {
  const res = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: REPLICATE_MODEL_VERSION,
      input: {
        source_image: sourceImageUrl,
        driven_audio: drivenAudioUrl,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getPrediction(id: string): Promise<ReplicatePrediction> {
  const res = await fetch(`${REPLICATE_API_BASE}/predictions/${id}`, {
    headers: { Authorization: `Bearer ${apiToken()}` },
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function downloadOutput(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Replicate output: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}
