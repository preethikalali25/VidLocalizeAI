-- Phase 4 schema: multi-speaker face replacement, additive alongside the
-- existing single-avatar pipeline (jobs.pipeline_mode picks which one a
-- given job uses -- nothing about the existing single_avatar path changes).
--
-- Uses the same dynamic-constraint-lookup pattern as
-- 0006_fix_avatar_category_constraint.sql for the jobs.status widen,
-- rather than guessing the auto-generated constraint name -- that's bitten
-- us twice already (0004's guess was wrong).

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%in%'
      and pg_get_constraintdef(oid) ilike '%validating%'
  loop
    execute format('alter table public.jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.jobs add constraint jobs_status_check
  check (status in (
    'validating','extracting','transcribing','translating',
    'synthesizing_speech','generating_avatar','lip_syncing','rendering',
    'complete','error',
    'diarizing','awaiting_speaker_review','compositing'
  ));

-- Meaningless for multi_speaker jobs -- per-speaker assignment lives in
-- job_speakers instead.
alter table public.jobs alter column avatar_category drop not null;

alter table public.jobs add column pipeline_mode text not null default 'single_avatar'
  check (pipeline_mode in ('single_avatar', 'multi_speaker'));

-- ============ job_speakers ============
-- One row per speaker Gemini's diarization pass detects. avatar_category
-- starts null and is filled in by the human during the
-- awaiting_speaker_review pause -- deliberately never auto-guessed (see
-- Phase 4 plan).

create table public.job_speakers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,

  speaker_label text not null, -- Gemini's own "Speaker 1" / "Speaker 2" id
  representative_frame_storage_path text,
  avatar_category text check (avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_speakers_job_id_idx on public.job_speakers (job_id);

alter table public.job_speakers enable row level security;
create policy "job_speakers_select_own" on public.job_speakers for select
  using (exists (
    select 1 from public.jobs j
    where j.id = job_speakers.job_id and j.user_id = auth.uid()
  ));
-- No insert/update/delete policy: only advance-job and
-- submit-speaker-assignments write these, both via service_role.

create trigger job_speakers_set_updated_at before update on public.job_speakers
  for each row execute function public.set_updated_at();

-- ============ job_segments ============
-- One row per speaking segment. status tracks this segment's own
-- per-stage progress (pending_tts -> pending_faceswap -> pending_lipsync
-- -> ready/failed) independently of the parent job's status.

create table public.job_segments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  speaker_id uuid not null references public.job_speakers(id) on delete cascade,

  sequence_index smallint not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  source_text text,
  translated_text text,

  tts_storage_path text,
  faceswap_prediction_id text,
  faceswap_output_storage_path text,
  lipsync_prediction_id text,
  final_segment_storage_path text,

  status text not null default 'pending_tts' check (status in (
    'pending_tts','pending_faceswap','pending_lipsync','ready','failed'
  )),
  retry_count smallint not null default 0,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_segments_job_id_idx on public.job_segments (job_id, sequence_index);
create index job_segments_speaker_id_idx on public.job_segments (speaker_id);
-- Matches the segment-loop stages' access pattern: "pending work for this job".
create index job_segments_pending_idx on public.job_segments (job_id, status)
  where status not in ('ready', 'failed');

alter table public.job_segments enable row level security;
create policy "job_segments_select_own" on public.job_segments for select
  using (exists (
    select 1 from public.jobs j
    where j.id = job_segments.job_id and j.user_id = auth.uid()
  ));
-- No insert/update/delete policy: only advance-job writes these, via service_role.

create trigger job_segments_set_updated_at before update on public.job_segments
  for each row execute function public.set_updated_at();

-- ============ job_events: per-segment log lines ============
-- Nullable -- most events (job-level stages) still have no segment_id.
-- Without this, a job with 6 segments logging independently at the TTS/
-- face-swap/lip-sync stages becomes an unreadable interleaved mess in the
-- log panel.

alter table public.job_events add column segment_id uuid references public.job_segments(id) on delete cascade;
create index job_events_segment_id_idx on public.job_events (segment_id) where segment_id is not null;

-- ============ realtime ============
-- Lets the new speaker-review screen and per-segment status display reuse
-- ProcessingPage.tsx's existing Realtime-subscription pattern.

alter publication supabase_realtime add table public.job_speakers;
alter publication supabase_realtime add table public.job_segments;
