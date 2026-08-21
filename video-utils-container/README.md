# video-utils-container

Phase 4's dedicated ffmpeg service — the one piece of the multi-speaker
pipeline that isn't a Supabase Edge Function or an AI vendor call, because
Edge Functions structurally can't run ffmpeg (see the Phase 4 plan's
compositing-infra section for why). It trims clips, extracts still frames,
and splices/concatenates the final video. Stateless, no Supabase
credentials of its own — see `server.js`'s top comment for the contract.

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
```

Play each output file and confirm it looks right before going further —
this is exactly the kind of thing that's much faster to catch here than
after wiring it into the full async job pipeline.

If any of these fail: read the JSON error response first (it includes
ffmpeg's stderr), and check that `ffmpeg`/`ffprobe` are actually on your
PATH (`ffmpeg -version`) if running outside the Docker image.

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
