// Client for the Phase 4 "video utils" container -- a small dedicated
// service (NOT a Supabase Edge Function, see video-utils-container/) that
// does the video operations Edge Functions structurally can't: real
// ffmpeg trim/splice/concat. See the Phase 4 plan's compositing-infra
// decision for why this exists as separate infra rather than trying to do
// this in Deno.
//
// STATUS AS OF WRITING: this client is written and ready to call, but the
// container itself needs to be BUILT and DEPLOYED (see
// video-utils-container/README.md) before any of this works -- that's a
// manual setup step, same category as creating the Supabase/Gemini/
// Replicate accounts were. Every call here fails with a clear "not
// configured" error until VIDEO_UTILS_URL is set as an Edge Function
// secret.
//
// Contract: the container is a stateless ffmpeg processor with no
// Supabase credentials of its own -- it downloads whatever input URLs
// you give it, and returns the processed file as raw bytes in the HTTP
// response body (same shape as _shared/replicate.ts's downloadOutput).
// The caller (an advance-job stage) is responsible for uploading those
// bytes into Supabase Storage, exactly like every other external output
// in this pipeline (Gemini TTS audio, Replicate predictions).
//
// Auth: a shared-secret bearer token (VIDEO_UTILS_SECRET), not Supabase
// JWTs -- this container has no relationship to Supabase auth, it's a
// plain internal service only advance-job ever talks to.

function baseUrl(): string {
  const url = Deno.env.get("VIDEO_UTILS_URL");
  if (!url) throw new Error("VIDEO_UTILS_URL is not set -- the video-utils container hasn't been deployed/configured yet");
  return url.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const secret = Deno.env.get("VIDEO_UTILS_SECRET");
  if (!secret) throw new Error("VIDEO_UTILS_SECRET is not set");
  return { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
}

async function readVideoResponse(res: Response, opName: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!res.ok) throw new Error(`video-utils ${opName} failed: ${res.status} ${await res.text()}`);
  const contentType = res.headers.get("content-type") ?? "video/mp4";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

// Trims [startSeconds, endSeconds) out of a source video. Used to produce
// each segment's original-footage clip, which is what the face-swap model
// takes as its "target video" input (it needs a short clip to swap the
// face within, not a full multi-minute video).
export async function trimClip(
  sourceVideoUrl: string,
  startSeconds: number,
  endSeconds: number
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(`${baseUrl()}/trim-clip`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ source_video_url: sourceVideoUrl, start_seconds: startSeconds, end_seconds: endSeconds }),
  });
  return readVideoResponse(res, "trim-clip");
}

// Extracts a still frame (JPEG) at a given timestamp. For
// job_speakers.representative_frame_storage_path (see the known gap noted
// in diarizing.ts) -- not yet wired into any stage.
export async function extractFrame(
  sourceVideoUrl: string,
  timestampSeconds: number
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(`${baseUrl()}/extract-frame`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ source_video_url: sourceVideoUrl, timestamp_seconds: timestampSeconds }),
  });
  return readVideoResponse(res, "extract-frame");
}

export interface ReplacementSegment {
  start_seconds: number;
  end_seconds: number;
  clip_url: string;
}

// Downloads a YouTube video (via yt-dlp inside the container -- see its
// README for the legal-gray-area note) and returns it as an mp4. A single
// blocking call, same timeout caveat as compositeVideo below: if this
// starts timing out on longer videos in practice, the container's
// contract would need to change to an async start+poll shape.
export async function fetchYoutubeVideo(youtubeUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(`${baseUrl()}/fetch-youtube`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  });
  return readVideoResponse(res, "fetch-youtube");
}

// Final assembly: splices each replacement clip into the original video at
// its time range (ranges with no replacement segment queued -- e.g.
// speakers dropped by the MAX_SPEAKERS cap, or overlapping-speech ranges,
// per the Phase 4 plan's v1 cuts -- keep the original footage untouched),
// concatenates, and returns one finished video.
export async function compositeVideo(
  sourceVideoUrl: string,
  replacementSegments: ReplacementSegment[]
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(`${baseUrl()}/composite`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ source_video_url: sourceVideoUrl, replacement_segments: replacementSegments }),
  });
  return readVideoResponse(res, "composite");
}
