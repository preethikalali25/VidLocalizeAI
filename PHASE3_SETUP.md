# Phase 3 setup: turning on real AI processing

The app's frontend and backend code are both written and committed, but
nothing runs for real until you do the steps below — creating accounts,
generating API keys, and deploying. None of this can be done on your
behalf; an AI agent can't create third-party accounts or spend your money.

Until you complete this, the app runs in a safe "not configured" mode:
`NewJobPage` blocks submission with a clear message, `DashboardPage` and
`ProcessingPage` show a "Real processing isn't set up yet" state instead of
crashing.

## What you'll end up with

- A Supabase project (Postgres + Storage + Edge Functions + free Auth)
- A Gemini API key (transcription, translation, and — by default — TTS)
- A Replicate API key (avatar generation + lip-sync)
- Optionally, a Google Cloud TTS key (only if Gemini's TTS turns out not to
  cover Hindi/Telugu/Tamil/Kannada/Bengali well enough — see step 8)

Total cost to get this working: Supabase free tier, Gemini free tier,
Replicate's free trial credit. Expect to eventually pay a small amount per
video once trial credit runs out — Replicate's avatar/lip-sync step is the
one part of this pipeline that isn't free indefinitely.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Once it's created, go to **Settings → API** and note down:
   - **Project URL**
   - **anon public key**
   - **service_role key** (keep this one secret — never put it in frontend code)

## 2. Enable anonymous sign-ins

**Authentication → Providers → Anonymous** → toggle it on.

This app has no login screen — every visitor gets a silent anonymous
session so Row Level Security can scope their jobs to them.

## 3. Create the storage bucket

**Storage → New bucket** → name it exactly `job-assets` → set it **Private**.

## 4. Run the database migrations

Open **SQL Editor** in the Supabase dashboard and run, in order:

1. `supabase/migrations/0001_init.sql` — **before running**, replace the two
   placeholders near the bottom (`<PROJECT_REF>` and `<SERVICE_ROLE_KEY>`)
   in the `cron.schedule(...)` call with your actual project ref (the
   subdomain in your Project URL) and service_role key.
2. `supabase/migrations/0002_storage.sql`
3. `supabase/migrations/0003_avatar_photos.sql` — sets up user-uploaded
   avatar photos (see step 11 below). Note: this deletes any existing rows
   in `jobs` as part of a column swap — read the comment at the top of the
   file before running if you want to keep old test data instead.
4. `supabase/migrations/0004_add_avatar_age_categories.sql` — widens the
   avatar category set from 4 to 6 (adds old man / old woman).
5. `supabase/migrations/0005_storage_update_policy.sql` — adds a missing
   UPDATE policy for the `job-assets` bucket (needed for re-uploading/
   replacing an avatar photo).
6. `supabase/migrations/0006_fix_avatar_category_constraint.sql` — cleans
   up a leftover overly-narrow check constraint that 0004 failed to
   actually remove (find-by-content instead of guessing the constraint
   name, so it's safe to run regardless of what state your project is in).

If `cron.schedule` errors on the `'20 seconds'` syntax, change it to
`'* * * * *'` (every minute) — some projects' `pg_cron` versions only
support minute-level schedules.

## 5. Get a Gemini API key

[aistudio.google.com](https://aistudio.google.com) → Get API key. Free,
no credit card.

## 6. Get a Replicate API token

[replicate.com](https://replicate.com) → sign up (GitHub login works) →
Account → API tokens. Note your starting trial credit amount — it changes
over time and determines how many test videos you get before needing to
add a card.

## 7. Set Edge Function secrets

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you
haven't, then from the repo root:

```sh
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set GEMINI_API_KEY=<your-gemini-key>
supabase secrets set REPLICATE_API_TOKEN=<your-replicate-token>
```

You do **not** need to manually set `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` — Supabase injects those into every Edge
Function automatically.

## 8. (Only if needed) Google Cloud TTS fallback

The pipeline defaults to Gemini's own TTS for the `synthesizing_speech`
stage — same API key as transcription/translation, no extra account. This
is untested against all five target languages as of writing.

If, once you test it, Gemini TTS's output quality is poor or a language is
unsupported: create a GCP project, enable the **Cloud Text-to-Speech API**,
enable billing (a card is required even for the free tier — this is why
it's not the default), generate an API key scoped to that API, then:

```sh
supabase secrets set GOOGLE_TTS_API_KEY=<your-gcp-tts-key>
```

Setting this key switches `synthesizing_speech` over to Google Cloud TTS
automatically — no code change needed (see `supabase/functions/_shared/tts.ts`).

## 9. Deploy the Edge Functions

```sh
supabase functions deploy create-job
supabase functions deploy advance-job
```

## 10. Set frontend env vars

**Local development** — create `.env.local` (copy `.env.example`):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

**GitHub Pages deploy** — repo **Settings → Secrets and variables →
Actions → New repository secret**, add both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The deploy workflow already reads these
(`.github/workflows/deploy-pages.yml`) — no workflow changes needed, just
add the secrets and push/re-run.

## 11. Test end to end

1. `npm run dev`, go to `/avatars` and upload one photo for at least one of
   the six categories (man / woman / boy child / girl child / old man /
   old woman) — this is a one-time step, the photo is reused for every
   future job. Re-uploading a category replaces the previous photo.
2. Go to `/new`.
3. Upload a short clip (under 3 minutes — the v1 cap in
   `src/constants/index.ts`, `MAX_UPLOAD_DURATION_SECONDS`).
4. On the "Choose Avatar" step, only categories you've uploaded a photo for
   are selectable — others show "Not uploaded."
5. Submit, watch `/processing/:id` — you should see real log messages
   appear from `job_events` as each stage actually runs, not fake timers.
6. On success, the download button should give you a real generated video
   using *your* uploaded photo as the avatar's face.
7. If a stage fails, the page shows the real error message (check
   **Edge Functions → Logs** in the Supabase dashboard for the full stack
   trace — the UI only shows the summary).

## Known rough edges to expect on first run

- **Model/API drift**: `GEMINI_MODEL` in `_shared/gemini.ts` and the
  Replicate model slug in `_shared/replicate.ts` are current as of when
  this was written but AI vendors rename/retire models — if a call fails
  with a "not found" style error, that's the first thing to check.
- **Voice coverage**: see step 8 — Gemini TTS's language coverage for
  Telugu/Tamil/Kannada/Bengali specifically hasn't been verified.
- **Raise the length cap**: once a few short clips work reliably, bump
  `MAX_UPLOAD_DURATION_SECONDS` in both `src/constants/index.ts` (client
  check) and `supabase/functions/advance-job/stages/validating.ts` +
  `supabase/functions/create-job/index.ts` (server checks — all three need
  to move together).
