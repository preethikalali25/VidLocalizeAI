# Phase 4 setup: multi-person face replacement (beta)

Phase 4 adds a second pipeline mode alongside Phase 3's single-avatar
narrator: detect each person who speaks in a video, and replace each of
them with your own uploaded avatar, lip-synced to their own translated
speech. See the plan this was built from for the full architecture and
why it's scoped the way it is (v1 speaker cap, no overlapping-speech
handling, no duration reconciliation, etc.) — this doc is just the
"what do I need to do" checklist.

**Read this before testing**: every real bug in Phase 3 (wrong Gemini
model, wrong Replicate endpoint, a missing RLS policy, a missing file
extension) was found only by running it live and pasting back the error —
nothing here could be verified from the sandbox this was built in. Phase 4
is architecturally bigger than Phase 3, with more new integrations, so
expect more rounds of that same loop, not fewer.

## What's new to set up (on top of everything in PHASE3_SETUP.md)

### 1. Run the new migrations

In order, after everything in `PHASE3_SETUP.md`:

1. `supabase/migrations/0007_multi_speaker_schema.sql` — new `job_speakers`
   and `job_segments` tables, widens `jobs.status`, makes
   `jobs.avatar_category` nullable, adds `jobs.pipeline_mode`.
2. `supabase/migrations/0008_youtube_input.sql` — YouTube URL as a second
   input method (see below): widens `jobs.input_method` and `jobs.status`,
   makes `jobs.source_storage_path` nullable, adds `jobs.source_youtube_url`.

### 2. Deploy the new Edge Function

```sh
supabase functions deploy submit-speaker-assignments
```

And redeploy the two you already have, since both changed substantially:

```sh
supabase functions deploy create-job
supabase functions deploy advance-job
```

### 3. Verify the face-swap and lip-sync Replicate models

`supabase/functions/_shared/replicate.ts` has two model version hashes
marked `REPLACE_ME_..._VERSION_HASH` — these are **unverified placeholders**,
unlike `SADTALKER_VERSION` (which was confirmed live against your account
earlier). Every job using multi-speaker mode will fail at the face-swap or
lip-sync step until you fix these, the same way SadTalker failed until its
endpoint was corrected.

For each of `FACE_SWAP_VERSION` and `LIP_SYNC_VERSION`:

1. Visit the model's page (starting points: `replicate.com/easel/advanced-face-swap`
   for face-swap, `replicate.com/sync/lipsync-2-pro` for lip-sync — search
   Replicate for "face swap" / "lip sync" if either doesn't exist anymore)
2. Click the **API** tab → **HTTP** — note the `version` hash in the sample
   request, and the exact `input` field names
3. Update `_shared/replicate.ts`'s `FACE_SWAP_VERSION`/`LIP_SYNC_VERSION`
   and the input field names in `createFaceSwapPrediction`/
   `createLipSyncPrediction` to match
4. Redeploy `advance-job`

### 4. Build and deploy the video-utils container

This is a **new, separate service** (not a Supabase Edge Function) — the
only piece of this pipeline that runs real ffmpeg, since Edge Functions
can't. Full instructions are in `video-utils-container/README.md`,
including how to test it locally first (do this before deploying — it's
the one part of Phase 4 you can fully verify yourself, independent of the
rest of the pipeline).

Short version:

```sh
cd video-utils-container
npm install
VIDEO_UTILS_SECRET=test-secret node server.js   # test locally first, see the README
fly launch --no-deploy && fly secrets set VIDEO_UTILS_SECRET=$(openssl rand -hex 32) && fly deploy
```

Then wire it in:

```sh
supabase secrets set VIDEO_UTILS_URL=https://<your-deployed-url>
supabase secrets set VIDEO_UTILS_SECRET=<same secret you set above>
supabase functions deploy advance-job
```

### 5. YouTube URL input

Adds a second way to start a job — paste a YouTube URL instead of
uploading a file — using the same `video-utils-container` from step 4,
now also running `yt-dlp`. **Legal note**: downloading YouTube videos
this way is in a gray area under YouTube's own ToS, even though it's
extremely widely used for personal tools like this one. Your call.

**Expect this to hit "Sign in to confirm you're not a bot"** once
deployed — YouTube increasingly blocks requests from datacenter IPs
(every cloud host, not just Fly.io) regardless of which video you ask
for. The fix is cookie-based auth, covered in
`video-utils-container/README.md`'s "If fetch-youtube fails with 'Sign
in to confirm you're not a bot'" section — set `YOUTUBE_COOKIES_B64` as
a Fly secret (optional env var, everything works without it, just more
likely to hit this error on some videos).

If you already deployed the container for step 4, you need to **rebuild
and redeploy it** — its `Dockerfile` changed to install `yt-dlp`
alongside ffmpeg:

```sh
cd video-utils-container
fly deploy   # or your Railway equivalent -- picks up the Dockerfile change
```

Everything else (the container's URL/secret, `advance-job`'s config) is
unchanged from step 4 — no new secrets to set for this part. Redeploy the
two functions this touched:

```sh
supabase functions deploy create-job
supabase functions deploy advance-job
```

Test it standalone first, same principle as the rest of this container —
see the `/fetch-youtube` example in `video-utils-container/README.md`,
try it against a short public video before testing through the full app.

## Test end to end

1. `npm run dev` (or your deployed site), go to `/new`
2. On step 3, choose **"Multiple people (beta)"** instead of the default
   "One presenter" — you don't pick an avatar here for this mode
3. Submit. The job will progress through validating → extracting →
   diarizing, then **pause** with status "Awaiting Your Input"
4. On `/processing/:id`, you'll see each detected speaker with a
   transcript snippet (no thumbnail photo yet — see the known gap below)
   — assign one of your uploaded avatar categories to each, then submit
5. Processing resumes: translating → processing segments (voice, face
   swap, lip sync per speaker) → compositing → complete
6. Download and check the result

Start with a **short, single-continuous-shot clip** with 2 clearly
distinct speakers for your first test — per the plan, rapid cuts and 3+
speakers are much harder cases to debug first.

To test YouTube input specifically: on step 1, click the now-unlocked
**YouTube URL** tab instead of Upload File, paste a short (under 180s)
public video's URL. The job starts at a new "fetching_source" stage
(downloading via the container) before joining the normal flow at
validating — works with either avatar mode, not just multi-speaker.

## Known gaps in this build

- **No representative photo in the speaker review screen** — extracting a
  still frame from the video needs the same ffmpeg container, and that
  call isn't wired in yet (`extractFrame()` exists in
  `_shared/videoUtils.ts` and the container supports `/extract-frame`, but
  no pipeline stage calls it). The review screen works fine without it —
  you get a speaker label and transcript snippet, no photo — this is
  purely a nice-to-have follow-up.
- **No duration/time-stretch reconciliation** — a translated segment may
  run longer or shorter than its original slot; expect drift or a visible
  jump-cut at segment boundaries.
- **Max 3 detected speakers** — extras keep their original, unmodified
  footage rather than being replaced.
- **No overlapping-speech handling** — if two people talk at once, that
  range keeps the original footage.
- **YouTube job titles** come from YouTube's public oEmbed endpoint
  (no API key needed); if that lookup fails for any reason it falls back
  to a generic "YouTube Video" title — cosmetic only, doesn't affect
  processing.
- **yt-dlp is the most likely thing to break over time** — it fights an
  ongoing cat-and-mouse battle with YouTube's own anti-scraping changes.
  If `/fetch-youtube` starts failing with extraction/signature errors,
  rebuild the container image to pick up a newer yt-dlp release (see
  `video-utils-container/README.md`).
