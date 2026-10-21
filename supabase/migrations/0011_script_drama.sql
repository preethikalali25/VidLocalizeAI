-- script_drama pipeline: generate an original short video from a script
-- (character name + dialogue line pairs) using fictional AI avatars --
-- no source video, no real actors, no copyright concerns. Reuses
-- SadTalker (same talking-head generation as single_avatar) once per
-- line, then stitches the resulting clips together in order. See the
-- advance-job stage files (parsing_script.ts, generating_clips.ts,
-- assembling_video.ts) for the actual pipeline logic.

alter table public.jobs add column script_text text;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%pipeline_mode%'
  loop
    execute format('alter table public.jobs drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_pipeline_mode_check
  check (pipeline_mode in ('single_avatar', 'multi_speaker', 'script_drama'));

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%input_method%'
  loop
    execute format('alter table public.jobs drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_input_method_check
  check (input_method in ('upload', 'youtube', 'script'));

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass and contype = 'c'
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
    'diarizing','awaiting_speaker_review','compositing',
    'fetching_source',
    'parsing_script','awaiting_character_avatars','translating_lines','generating_clips','assembling_video'
  ));

-- title/source_lang/target_language/avatar_category/source_duration_seconds/
-- source_size_bytes are all already nullable or already meaningful for a
-- script_drama job (avatar_category stays null, same as multi_speaker --
-- per-character assignment lives in drama_characters instead).

-- ============ drama_characters ============
-- One row per distinct character name Gemini's script-parsing pass finds
-- (script_drama jobs only). avatar_category starts null and is filled in
-- by the human during the awaiting_character_avatars pause, same pattern
-- as job_speakers.avatar_category for multi_speaker.

create table public.drama_characters (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,

  name text not null, -- as it appears in the script, e.g. "MOM"
  avatar_category text check (avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drama_characters_job_id_idx on public.drama_characters (job_id);

alter table public.drama_characters enable row level security;
create policy "drama_characters_select_own" on public.drama_characters for select
  using (exists (
    select 1 from public.jobs j
    where j.id = drama_characters.job_id and j.user_id = auth.uid()
  ));
-- No insert/update/delete policy: only advance-job and
-- submit-character-avatars write these, both via service_role.

create trigger drama_characters_set_updated_at before update on public.drama_characters
  for each row execute function public.set_updated_at();

-- ============ drama_lines ============
-- One row per dialogue line, in script order. status tracks this line's
-- own per-stage progress (pending_tts -> pending_clip -> ready/failed)
-- independently of the parent job's status -- same "one tick = one unit
-- of work" shape as job_segments in the multi_speaker pipeline, just
-- simpler (no face-swap, no block-merging -- every line gets its own
-- clip, concatenated back to back by assembling_video.ts).

create table public.drama_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  character_id uuid not null references public.drama_characters(id) on delete cascade,

  sequence_index smallint not null,
  source_text text not null,
  translated_text text,

  tts_storage_path text,
  replicate_prediction_id text,
  clip_storage_path text,

  status text not null default 'pending_tts' check (status in (
    'pending_tts','pending_clip','ready','failed'
  )),
  retry_count smallint not null default 0,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drama_lines_job_id_idx on public.drama_lines (job_id, sequence_index);
create index drama_lines_character_id_idx on public.drama_lines (character_id);
create index drama_lines_pending_idx on public.drama_lines (job_id, status)
  where status not in ('ready', 'failed');

alter table public.drama_lines enable row level security;
create policy "drama_lines_select_own" on public.drama_lines for select
  using (exists (
    select 1 from public.jobs j
    where j.id = drama_lines.job_id and j.user_id = auth.uid()
  ));
-- No insert/update/delete policy: only advance-job writes these, via service_role.

create trigger drama_lines_set_updated_at before update on public.drama_lines
  for each row execute function public.set_updated_at();

-- ============ job_events: already supports segment_id, reused as-is ============
-- segment_id on job_events points at job_segments only (multi_speaker) --
-- drama line-level events just log without a line reference, same as
-- single_avatar's job-level-only events. Not worth a second nullable FK
-- column for this.

-- ============ realtime ============

alter publication supabase_realtime add table public.drama_characters;
alter publication supabase_realtime add table public.drama_lines;
