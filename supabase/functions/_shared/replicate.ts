// Avatar generation + lip-sync via Replicate, using the "create prediction
// from a model" endpoint (always runs the model's latest version, so we
// don't have to pin/track a version hash that goes stale).
//
// Target model: lucataco/sadtalker (single portrait image + audio -> talking
// head video). Confirm this model still exists and check its current input
// field names at https://replicate.com/lucataco/sadtalker/api when you set
// this up -- Replicate model APIs occasionally change their input schema.

const REPLICATE_MODEL = "lucataco/sadtalker";
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
  const res = await fetch(`${REPLICATE_API_BASE}/models/${REPLICATE_MODEL}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
