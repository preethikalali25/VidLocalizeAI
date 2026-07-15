-- VidLocalizeAI Phase 3 schema: real job pipeline state, replacing localStorage.
--
-- Run this once against a fresh Supabase project (SQL editor, or
-- `supabase db push` if you're using the CLI). Before running, replace the
-- two placeholders in the cron.schedule() call at the bottom:
--   <PROJECT_REF>       -- your project ref, e.g. abcdefghijklmnop
--   <SERVICE_ROLE_KEY>  -- Settings -> API -> service_role key (keep secret)

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============ jobs ============

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  title text not null,
  source_lang text not null,
  target_language text not null check (target_language in ('hindi','telugu','tamil','kannada','bengali')),
  avatar_gender text not null check (avatar_gender in ('male','female')),
  avatar_style text not null check (avatar_style in ('professional','casual','news_anchor')),
  avatar_name text not null,

  input_method text not null default 'upload' check (input_method = 'upload'), -- v1: upload only, no YouTube ingestion

  source_storage_path text not null,
  source_file_name text,
  source_duration_seconds numeric,
  source_size_bytes bigint,

  status text not null default 'validating' check (status in (
    'validating','extracting','transcribing','translating',
    'synthesizing_speech','generating_avatar','lip_syncing','rendering',
    'complete','error'
  )),
  progress smallint not null default 0 check (progress between 0 and 100),

  -- typed pipeline handoff data -- each stage only ever needs one specific
  -- value, so these stay as explicit columns rather than one jsonb blob
  gemini_file_uri text,
  transcript_text text,
  translated_text text,
  tts_storage_path text,
  replicate_prediction_id text,
  output_storage_path text,

  retry_count smallint not null default 0,
  error_message text,
  meta jsonb not null default '{}'::jsonb,  -- diagnostics only: raw API payloads, token usage

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_advanced_at timestamptz not null default now(),
  completed_at timestamptz
);

create index jobs_user_id_idx on public.jobs (user_id);
create index jobs_status_advance_idx on public.jobs (status, last_advanced_at)
  where status not in ('complete', 'error');

alter table public.jobs enable row level security;
create policy "jobs_select_own" on public.jobs for select using (auth.uid() = user_id);
create policy "jobs_insert_own" on public.jobs for insert with check (auth.uid() = user_id);
create policy "jobs_update_own" on public.jobs for update using (auth.uid() = user_id);
create policy "jobs_delete_own" on public.jobs for delete using (auth.uid() = user_id);
-- The advance-job Edge Function runs with the service_role key and bypasses
-- RLS entirely -- it's the only thing allowed to move a job between stages.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ============ job_events ============
-- Real backing for the "AI Processing Log" panel in ProcessingPage.tsx,
-- which today shows fabricated strings. Also the only debugging surface
-- when a Gemini/TTS/Replicate call fails on someone else's job.

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage text not null,
  level text not null default 'info' check (level in ('info','error')),
  message text not null,
  created_at timestamptz not null default now()
);

create index job_events_job_id_idx on public.job_events (job_id, created_at);

alter table public.job_events enable row level security;
create policy "job_events_select_own" on public.job_events for select
  using (exists (
    select 1 from public.jobs j
    where j.id = job_events.job_id and j.user_id = auth.uid()
  ));
-- No insert policy: all inserts come from advance-job via service_role.

-- ============ realtime ============
-- Lets ProcessingPage subscribe to live status/progress and log updates
-- instead of polling.

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_events;

-- ============ cron sweep ============
-- Ticks any non-terminal job forward roughly every 20s. This is what lets
-- long-running external calls (Replicate avatar generation in particular)
-- advance without needing a single Edge Function invocation to block for
-- the entire duration of an external job.
--
-- If your project's pg_cron rejects sub-minute syntax, use '* * * * *'
-- (every minute) instead of '20 seconds'.

select cron.schedule(
  'advance-jobs-sweep',
  '20 seconds',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/advance-job',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
