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

function tempPath(suffix) {
  return path.join(os.tmpdir(), `vu-${crypto.randomUUID()}${suffix}`);
}

async function cleanup(paths) {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
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

app.listen(PORT, () => console.log(`video-utils-container listening on ${PORT}`));
