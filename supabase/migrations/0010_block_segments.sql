-- Lets the multi-speaker pipeline keep a speaker's swapped face showing
-- through their own silent stretches (listening, pausing) instead of
-- reverting to the original footage the instant they stop talking.
--
-- A "block" is a run of one speaker's own consecutive segments (in
-- chronological order across the whole video) with no OTHER speaker's
-- segment in between -- grouped at diarization time (see diarizing.ts's
-- groupIntoBlocks). Every segment in a block still gets its own
-- individual translation/TTS (so phrasing/pacing per sentence is
-- unchanged), but only the block's "leader" (its first segment --
-- block_leader_id is null) carries the actual face-swap/lip-sync output,
-- covering the block's full extended range (block_start_seconds to
-- block_end_seconds). The other segments in the block ("followers") point
-- back to the leader via block_leader_id and, once their own TTS is done,
-- their audio is stitched into the leader's single combined track (see
-- processing_segments.ts's processAwaitingFollowers + the video-utils
-- container's /stitch-audio endpoint) rather than getting their own
-- separate face-swap/lip-sync pass.
--
-- A solo segment (no other same-speaker segment adjacent to it) is simply
-- a block of one -- block_leader_id null, block_start/end equal to its
-- own start/end, no stitching needed.

alter table public.job_segments
  add column block_leader_id uuid references public.job_segments(id) on delete cascade,
  add column block_start_seconds numeric,
  add column block_end_seconds numeric,
  add column stitched_audio_storage_path text;

create index job_segments_block_leader_id_idx on public.job_segments (block_leader_id)
  where block_leader_id is not null;

-- Same dynamic-constraint-lookup pattern as 0007/0006 -- guessing the
-- auto-generated check-constraint name has been wrong before.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.job_segments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%in%'
      and pg_get_constraintdef(oid) ilike '%pending_tts%'
  loop
    execute format('alter table public.job_segments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.job_segments add constraint job_segments_status_check
  check (status in (
    'pending_tts','awaiting_followers','merged',
    'pending_faceswap','pending_lipsync','ready','failed'
  ));

-- 'merged' is a dead end for the per-tick dispatcher (a follower has
-- nothing left to do once its own TTS lands) -- same reasoning as
-- excluding ready/failed.
drop index if exists job_segments_pending_idx;
create index job_segments_pending_idx on public.job_segments (job_id, status)
  where status not in ('ready', 'failed', 'merged');
