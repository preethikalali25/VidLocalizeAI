// Avatar generation (single_avatar pipeline) + face-swap/lip-sync
// (multi_speaker pipeline, Phase 4) via Replicate.

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

// Community models (as opposed to Replicate's own "official" models) don't
// support the /models/{owner}/{name}/predictions shortcut -- that 404s,
// confirmed the hard way on lucataco/sadtalker. They need this classic
// endpoint with an explicit pinned version instead.
async function createPrediction(modelVersion: string, input: Record<string, unknown>): Promise<ReplicatePrediction> {
  const res = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version: modelVersion, input }),
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// The flip side of createPrediction above: "official" models (as opposed
// to individual-uploaded community models) DO support this shortcut --
// confirmed live against sync/lipsync-2-pro's own HTTP API sample, which
// uses this exact endpoint with no version field at all (always runs
// whatever's currently latest). No local polling behavior change either
// way -- we deliberately don't send "Prefer: wait" here, same as every
// other prediction in this file, so this still starts a prediction and
// returns immediately rather than blocking the Edge Function invocation;
// processing_segments.ts polls it across ticks like any other.
async function createPredictionByModel(ownerModel: string, input: Record<string, unknown>): Promise<ReplicatePrediction> {
  const res = await fetch(`${REPLICATE_API_BASE}/models/${ownerModel}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Model: lucataco/sadtalker (single portrait image + audio -> talking head
// video). If predictions start failing with a 404/"not found" again, get
// the current version hash from the "HTTP" tab under
// https://replicate.com/lucataco/sadtalker/api and update this.
const SADTALKER_VERSION = "85c698db7c0a66d5011435d0191db323034e1da04b912a6d365833141b6a285b";

export function createAvatarPrediction(sourceImageUrl: string, drivenAudioUrl: string): Promise<ReplicatePrediction> {
  return createPrediction(SADTALKER_VERSION, {
    source_image: sourceImageUrl,
    driven_audio: drivenAudioUrl,
  });
}

// Model: prunaai/p-video-replace (full-person video swap -- one or more
// reference photos of a person + a target video -> video with that whole
// person swapped in throughout, motion-matched to the original footage).
// Supersedes the earlier face-only okaris/roop swap below, at the
// explicit ask to replace the whole person rather than just the face.
// Confirmed live against the model's own HTTP API sample
// (replicate.com/prunaai/p-video-replace/api) -- uses the model-shortcut
// endpoint like sync/lipsync-2-pro, no pinned version.
//
// Reuses the same avatar_photos face closeups as the reference image for
// now (first attempt, unverified quality) -- /avatars only collects face
// photos today, not full-body references, which this model may want for
// best results. Revisit if output quality suggests full-body reference
// photos are actually needed.
const PERSON_SWAP_MODEL = "prunaai/p-video-replace";

export function createPersonSwapPrediction(targetVideoUrl: string, sourceFaceImageUrl: string): Promise<ReplicatePrediction> {
  return createPredictionByModel(PERSON_SWAP_MODEL, {
    video: targetVideoUrl,
    images: [sourceFaceImageUrl],
  });
}

// Model: sync/lipsync-2-pro -- a real company's (Sync Labs) official
// Replicate listing, not a community upload, which is why it uses the
// model-shortcut endpoint above instead of a pinned version. Confirmed
// live against the model's own HTTP API sample
// (replicate.com/sync/lipsync-2-pro/api). Input field names (video,
// audio) already matched what this code had before any changes.
const LIP_SYNC_MODEL = "sync/lipsync-2-pro";

export function createLipSyncPrediction(videoUrl: string, audioUrl: string): Promise<ReplicatePrediction> {
  return createPredictionByModel(LIP_SYNC_MODEL, {
    video: videoUrl,
    audio: audioUrl,
  });
}

// Model: black-forest-labs/flux-schnell -- fast (seconds, not minutes)
// text-to-image, an official Black Forest Labs listing so this uses the
// model-shortcut endpoint like the lip-sync/person-swap models above.
// Used by generate-avatar-photo as an alternative to uploading a real
// photo for an avatar slot -- see that function for the guardrail wording
// appended to every prompt before it reaches here.
const AVATAR_IMAGE_MODEL = "black-forest-labs/flux-schnell";

export function createAvatarImagePrediction(prompt: string): Promise<ReplicatePrediction> {
  return createPredictionByModel(AVATAR_IMAGE_MODEL, {
    prompt,
    aspect_ratio: "3:4",
    output_format: "jpg",
  });
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
