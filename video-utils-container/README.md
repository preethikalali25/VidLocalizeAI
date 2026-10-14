# video-utils-container

A dedicated ffmpeg (+ yt-dlp) service — the piece of the pipeline that
isn't a Supabase Edge Function or an AI vendor call, because Edge
Functions structurally can't run arbitrary binaries. It trims clips,
extracts still frames, splices/concatenates the final video, and fetches
YouTube URLs as a video file. Stateless, no Supabase credentials of its
own — see `server.js`'s top comment for the contract.

**yt-dlp legal note**: downloading YouTube videos this way sits in a gray
area under YouTube's ToS, even though it's extremely widely used for
personal tools. Your call for your own project.

**This is the one part of Phase 4 you can fully test yourself, locally,
before any of it touches the live pipeline.** Do that first.

## 1. Test it locally

```sh
cd video-utils-container
npm install
VIDEO_UTILS_SECRET=test-secret node server.js
```

In another terminal, with a short sample video hosted somewhere fetchable
(any public URL, or run a throwaway local file server — `npx serve` in a
folder with a test clip works):

```sh
# Trim seconds 2-5 out of a video
curl -X POST http://localhost:8080/trim-clip \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{"source_video_url":"https://example.com/sample.mp4","start_seconds":2,"end_seconds":5}' \
  --output trimmed.mp4

# Grab a frame at the 3s mark
curl -X POST http://localhost:8080/extract-frame \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{"source_video_url":"https://example.com/sample.mp4","timestamp_seconds":3}' \
  --output frame.jpg

# Splice a replacement clip into a range of the source video
curl -X POST http://localhost:8080/composite \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{"source_video_url":"https://example.com/sample.mp4","replacement_segments":[{"start_seconds":2,"end_seconds":5,"clip_url":"https://example.com/trimmed.mp4"}]}' \
  --output composited.mp4

# Fetch a short public YouTube video as an mp4 (rejects anything over the
# 180s duration cap before downloading, and non-youtube.com/youtu.be URLs
# outright)
curl -X POST http://localhost:8080/fetch-youtube \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{"youtube_url":"https://www.youtube.com/watch?v=SOME_SHORT_VIDEO_ID"}' \
  --output youtube.mp4
```

Play each output file and confirm it looks right before going further —
this is exactly the kind of thing that's much faster to catch here than
after wiring it into the full async job pipeline.

If any of these fail: read the JSON error response first (it includes
ffmpeg's/yt-dlp's stderr), and check that `ffmpeg`/`ffprobe`/`yt-dlp` are
actually on your PATH (`ffmpeg -version`, `yt-dlp --version`) if running
outside the Docker image — `yt-dlp` specifically needs the standalone
Linux binary from the Dockerfile, a plain `pip install yt-dlp` also works
locally if you have Python.

yt-dlp's most common failure mode is an extraction error when YouTube
changes something internally — if fetch-youtube starts failing with
errors mentioning signature extraction or similar, the fix is almost
always upgrading yt-dlp (`yt-dlp -U` locally, or rebuild the Docker image
to pick up a newer release).

### If fetch-youtube fails with "Sign in to confirm you're not a bot"

This is a different, more common failure once this is actually deployed:
YouTube increasingly blocks requests from datacenter IPs (which is what
every cloud host, including Fly.io, uses) regardless of which video you
ask for. The fix is passing browser cookies from a real logged-in YouTube
session, so the request looks like it's coming from a signed-in browser.

**Strongly recommended: use a separate, throwaway Google account for
this, not your main one.** These cookies carry real session authority for
the whole Google account, not just YouTube, and they'll be sitting as a
secret on a cloud server. A dedicated account limits the blast radius if
anything ever leaks.

1. Log into YouTube in a browser with the account you're dedicating to
   this, install a cookie-export extension (e.g. "Get cookies.txt
   LOCALLY" for Chrome/Firefox), and export cookies for youtube.com as a
   Netscape-format `cookies.txt` file.
2. Base64-encode it and set it as a Fly secret (never committed to the
   repo, never baked into the Docker image):
   ```sh
   export YT_COOKIES_B64=$(base64 < cookies.txt | tr -d '\n')
   fly secrets set YOUTUBE_COOKIES_B64=$YT_COOKIES_B64
   ```
3. The container picks it up automatically on next start/deploy (decodes
   it once at startup, see `initYoutubeCookies()` in `server.js`) — no
   code change needed, this env var is optional and everything works the
   same without it (just more likely to hit bot-detection on some videos).

Cookies expire periodically (YouTube sessions aren't permanent) — when
`fetch-youtube` starts failing with the same "sign in to confirm" error
again after previously working, re-export and re-set the secret the same
way.

## 2. Deploy it

Any container host with a Docker deploy path works. Fly.io is a
reasonable default (usage-based, scales to zero when idle, no fixed
monthly minimum — matches this project's free-tier-first approach).

```sh
# from video-utils-container/
fly launch --no-deploy   # creates fly.toml, pick a region, say no to a DB
fly secrets set VIDEO_UTILS_SECRET=$(openssl rand -hex 32)
fly deploy
```

Note the app's URL (`https://<app-name>.fly.dev`) and the secret you set.

Railway works too if you'd rather use that: create a new project from this
directory (it'll detect the Dockerfile), set `VIDEO_UTILS_SECRET` in its
environment variables, deploy, and note the generated public URL.

Either way, confirm it's actually up before wiring it in:

```sh
curl https://<your-deployed-url>/health
# {"ok":true}
```

## 3. Wire it into the pipeline

Set these as Supabase Edge Function secrets (same `supabase secrets set`
flow as `GEMINI_API_KEY`/`REPLICATE_API_TOKEN`):

```sh
supabase secrets set VIDEO_UTILS_URL=https://<your-deployed-url>
supabase secrets set VIDEO_UTILS_SECRET=<the same secret you set above>
```

Then redeploy `advance-job` so it picks up the new secrets:

```sh
supabase functions deploy advance-job
```

## Known limitations (v1, see the Phase 4 plan)

- No duration/time-stretch reconciliation — each replacement clip is
  spliced in at whatever length it actually came out, which may not
  exactly match its original segment's duration. Expect visible drift or
  a small jump-cut at segment boundaries.
- `/composite` rejects overlapping replacement segments outright rather
  than trying to merge them — matches the "no overlapping-speech
  handling" v1 cut (those ranges should never reach this container with a
  replacement queued in the first place).
- Every operation re-encodes with libx264/aac rather than stream-copying,
  since spliced pieces come from different sources (original trims vs.
  face-swap/lip-sync model output) with incompatible codecs/timestamps.
  This is slower than a copy-only concat but far more reliable.
- `/fetch-youtube` caps resolution at 720p and rejects videos over 180s
  (checked via metadata before downloading, not after) — mirrors the same
  cap enforced on direct uploads elsewhere in this project. If you raise
  `MAX_UPLOAD_DURATION_SECONDS`, update `MAX_YOUTUBE_DURATION_SECONDS` at
  the top of `server.js` too (it's a separate copy, not a shared
  constant — this is a different JS runtime than the Edge Functions).
