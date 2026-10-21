-- Lets a named character (e.g. "Mom", "Lily") keep the SAME generated
-- avatar across every script_drama job a user submits, instead of
-- getting a fresh random face every single episode -- essential for a
-- multi-episode series where the same character needs to look
-- consistent episode to episode.
--
-- Keyed by (user_id, character_name), name normalized (trimmed,
-- lowercased) -- see generating_character_avatars.ts. The first time a
-- character name is seen, its generated avatar's storage path is cached
-- here; every later job with the same character name reuses that same
-- path directly (no new Replicate call, no cost) instead of generating
-- again. Known limitation: two unrelated shows that happen to both have
-- a character named "Mom" would share a face too -- there's no
-- per-series grouping, just per-user-per-name. Fine for one show at a
-- time; would need a real fix if that becomes a problem.

create table public.character_avatar_library (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  character_name text not null,
  avatar_category text check (avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman')),
  avatar_storage_path text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, character_name)
);

alter table public.character_avatar_library enable row level security;
create policy "character_avatar_library_select_own" on public.character_avatar_library for select
  using (auth.uid() = user_id);
-- No insert/update/delete policy: only advance-job writes these, via service_role.

create trigger character_avatar_library_set_updated_at before update on public.character_avatar_library
  for each row execute function public.set_updated_at();
