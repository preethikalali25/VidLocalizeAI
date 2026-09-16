-- Adds YouTube URL as a second input method alongside direct upload.
-- Dynamic constraint lookup, same pattern as 0006/0007, rather than
-- guessing the auto-generated name.

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%input_method%'
  loop
    execute format('alter table public.jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.jobs add constraint jobs_input_method_check
  check (input_method in ('upload', 'youtube'));

-- Only set once the fetching_source stage downloads the video and uploads
-- it to Storage -- null at creation time for youtube jobs.
alter table public.jobs alter column source_storage_path drop not null;

alter table public.jobs add column source_youtube_url text;

-- Widen the status check the same way (dynamic lookup, see above) to add
-- fetching_source -- the one new status, which only youtube jobs pass
-- through, before validating (unchanged from there on).
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
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
    'diarizing','awaiting_speaker_review','processing_segments','compositing',
    'fetching_source'
  ));
