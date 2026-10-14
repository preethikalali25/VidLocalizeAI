// Phase 4 video-utils container: a small stateless service that does the
// video operations Supabase Edge Functions structurally can't (real
// ffmpeg trim/splice/concat). See ../supabase/functions/_shared/videoUtils.ts
// for the client that calls this, and README.md in this directory for how
// to test and deploy it.
//
// Deliberately has NO Supabase credentials of its own -- it downloads
// whatever input URLs it's given and returns the processed file as raw
// bytes in the response. Uploading results into Supabase Storage is the
// caller's (advance-job's) job, same as every other external output in
// this pipeline.

const express = require("express");
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const SECRET = process.env.VIDEO_UTILS_SECRET;

if (!SECRET) {
  console.error("VIDEO_UTILS_SECRET is not set -- refusing to start with no auth configured.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" })); // request bodies are just URLs/numbers, never file contents

// Unauthenticated on purpose -- Fly.io/Railway health checks hit this
// without the bearer secret. It reveals nothing sensitive.
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length !== SECRET.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(SECRET))) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 1024 * 1024 * 50 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${err.message}\n${stderr}`));
      resolve();
    });
  });
}

function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}\n${stderr}`));
      resolve(stdout.trim());
    });
  });
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

// Mirrors MAX_UPLOAD_DURATION_SECONDS in src/constants/index.ts and
// supabase/functions/create-job/index.ts -- this is a separate JS runtime
// (Node here vs. Deno in the Edge Functions) with no shared import
// mechanism between them, so it's a second copy, not a shared constant.
// Keep all three in sync if the cap ever changes.
const MAX_YOUTUBE_DURATION_SECONDS = 180;

// Restricts this endpoint to actual YouTube URLs, even though yt-dlp
// itself supports hundreds of sites -- this container has no access
// control beyond the bearer secret, and there's no reason to let it act
// as a general-purpose URL-fetching proxy for whatever site a caller
// names.
function isYoutubeUrl(url) {
  try {
    const { hostname } = new URL(url);
    return /(^|\.)(youtube\.com|youtu\.be)$/.test(hostname);
  } catch {
    return false;
  }
}

function runYtDlp(args, maxBuffer = 1024 * 1024 * 20) {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", args, { maxBuffer }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`yt-dlp failed: ${err.message}\n${stderr}`));
      resolve(stdout);
    });
  });
}

function tempPath(suffix) {
  return path.join(os.tmpdir(), `vu-${crypto.randomUUID()}${suffix}`);
}

async function cleanup(paths) {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
}

// Optional: YOUTUBE_COOKIES_B64 is a base64-encoded cookies.txt (Netscape
// format, exported from a real logged-in YouTube session -- see README).
// YouTube increasingly blocks requests from datacenter IPs like this
// container's with "Sign in to confirm you're not a bot"; passing cookies
// makes yt-dlp's requests look like they come from that signed-in
// session. Decoded once at startup to a fixed path, not per-request --
// the file never changes while the process is running. If the env var
// isn't set, ytDlpCookieArgs() is just an empty array and everything
// behaves exactly as before (unauthenticated, may hit bot-detection on
// some videos).
let cookiesFilePath = null;

async function initYoutubeCookies() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return;
  const target = path.join(os.tmpdir(), "yt-cookies.txt");
  await fs.writeFile(target, Buffer.from(b64, "base64"));
  cookiesFilePath = target;
  console.log("Loaded YouTube cookies for yt-dlp authentication.");
}

function ytDlpCookieArgs() {
  return cookiesFilePath ? ["--cookies", cookiesFilePath] : [];
}

// POST /trim-clip { source_video_url, start_seconds, end_seconds } -> video/mp4 bytes
app.post("/trim-clip", async (req, res) => {
  const { source_video_url, start_seconds, end_seconds } = req.body || {};
  if (!source_video_url || typeof start_seconds !== "number" || typeof end_seconds !== "number") {
    return res.status(400).json({ error: "source_video_url, start_seconds, end_seconds are required" });
  }

  const src = tempPath(".mp4");
  const out = tempPath(".mp4");
  try {
    await downloadToFile(source_video_url, src);
    // -i before -ss/-to: slower than seek-before-input, but frame-accurate,
    // which matters here since these clips feed straight into a face-swap
    // model that needs to line up with a specific speaking segment.
    await runFfmpeg([
      "-y", "-i", src,
      "-ss", String(start_seconds), "-to", String(end_seconds),
      "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart",
      out,
    ]);
    const bytes = await fs.readFile(out);
    res.type("video/mp4").send(bytes);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await cleanup([src, out]);
  }
});

// POST /extract-frame { source_video_url, timestamp_seconds } -> image/jpeg bytes
app.post("/extract-frame", async (req, res) => {
  const { source_video_url, timestamp_seconds } = req.body || {};
  if (!source_video_url || typeof timestamp_seconds !== "number") {
    return res.status(400).json({ error: "source_video_url, timestamp_seconds are required" });
  }

  const src = tempPath(".mp4");
  const out = tempPath(".jpg");
  try {
    await downloadToFile(source_video_url, src);
    // -ss before -i here: fast seek is fine for a representative thumbnail,
    // exact frame accuracy doesn't matter the way it does for trim-clip.
    await runFfmpeg(["-y", "-ss", String(timestamp_seconds), "-i", src, "-frames:v", "1", "-q:v", "2", out]);
    const bytes = await fs.readFile(out);
    res.type("image/jpeg").send(bytes);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await cleanup([src, out]);
  }
});

// POST /composite { source_video_url, replacement_segments: [{start_seconds, end_seconds, clip_url}] } -> video/mp4 bytes
//
// Splices each replacement clip into the source video at its time range;
// ranges with no replacement segment keep the original footage untouched.
// No duration reconciliation (see the Phase 4 plan's known limitation) --
// each replacement clip is used as-is, whatever length it actually is.
app.post("/composite", async (req, res) => {
  const { source_video_url, replacement_segments } = req.body || {};
  if (!source_video_url || !Array.isArray(replacement_segments)) {
    return res.status(400).json({ error: "source_video_url and replacement_segments are required" });
  }

  const segments = [...replacement_segments].sort((a, b) => a.start_seconds - b.start_seconds);
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start_seconds < segments[i - 1].end_seconds) {
      return res.status(400).json({ error: "replacement_segments must not overlap" });
    }
  }

  const src = tempPath(".mp4");
  const pieceFiles = [];
  const clipFiles = [];
  const concatListPath = tempPath(".txt");
  const out = tempPath(".mp4");

  try {
    await downloadToFile(source_video_url, src);
    const durationStr = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]);
    const sourceDuration = parseFloat(durationStr);
    if (!Number.isFinite(sourceDuration)) throw new Error(`Could not determine source video duration (got "${durationStr}")`);

    await Promise.all(segments.map((seg, i) => downloadToFile(seg.clip_url, (clipFiles[i] = tempPath(`-clip${i}.mp4`)))));

    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.start_seconds > cursor) {
        const gapOut = tempPath(`-gap${i}.mp4`);
        await runFfmpeg([
          "-y", "-i", src,
          "-ss", String(cursor), "-to", String(seg.start_seconds),
          "-c:v", "libx264", "-c:a", "aac",
          gapOut,
        ]);
        pieceFiles.push(gapOut);
      }
      pieceFiles.push(clipFiles[i]);
      cursor = seg.end_seconds;
    }
    if (cursor < sourceDuration) {
      const tailOut = tempPath("-tail.mp4");
      await runFfmpeg(["-y", "-i", src, "-ss", String(cursor), "-to", String(sourceDuration), "-c:v", "libx264", "-c:a", "aac", tailOut]);
      pieceFiles.push(tailOut);
    }

    if (pieceFiles.length === 0) throw new Error("No pieces to composite (empty video or no segments)");

    const concatList = pieceFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    await fs.writeFile(concatListPath, concatList);
    // Re-encode on concat (not stream-copy) since pieces come from
    // different sources (original trims vs. face-swap/lip-sync model
    // output) with potentially different codecs/timestamps.
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", out]);

    const bytes = await fs.readFile(out);
    res.type("video/mp4").send(bytes);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await cleanup([src, out, concatListPath, ...pieceFiles, ...clipFiles]);
  }
});

// POST /fetch-youtube { youtube_url } -> video/mp4 bytes
//
// Checks the video's duration via --dump-json (no download) first and
// rejects anything over the cap before spending any bandwidth on it --
// same "fail fast" reasoning as create-job's other pre-checks.
app.post("/fetch-youtube", async (req, res) => {
  const { youtube_url } = req.body || {};
  if (!youtube_url || !isYoutubeUrl(youtube_url)) {
    return res.status(400).json({ error: "youtube_url is required and must be a youtube.com/youtu.be URL" });
  }

  const out = tempPath(".mp4");
  try {
    let meta;
    try {
      const raw = await runYtDlp(["--dump-json", "--no-warnings", "--skip-download", ...ytDlpCookieArgs(), youtube_url]);
      meta = JSON.parse(raw);
    } catch (err) {
      // Surfaced as-is -- yt-dlp's own error text already explains private/
      // age-restricted/region-locked/deleted videos clearly.
      throw new Error(`Could not read video info: ${err.message}`);
    }
    if (typeof meta.duration === "number" && meta.duration > MAX_YOUTUBE_DURATION_SECONDS) {
      return res.status(400).json({
        error: `Video is ${Math.round(meta.duration)}s, which exceeds the ${MAX_YOUTUBE_DURATION_SECONDS}s cap`,
      });
    }

    // Capped to 720p to keep downloads/uploads reasonably fast -- this is
    // a presenter-narration/dubbing pipeline, not a video archive, so
    // source resolution beyond this doesn't meaningfully help the output.
    await runYtDlp(
      [
        "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--no-warnings",
        "--no-playlist",
        ...ytDlpCookieArgs(),
        "-o", out,
        youtube_url,
      ],
      1024 * 1024 * 20
    );

    const bytes = await fs.readFile(out);
    res.type("video/mp4").send(bytes);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await cleanup([out]);
  }
});

initYoutubeCookies()
  .catch((err) => console.error("Failed to load YouTube cookies (continuing without them):", err))
  .finally(() => {
    app.listen(PORT, () => console.log(`video-utils-container listening on ${PORT}`));
  });
