-- Replaces the generic-stock-photo avatar system with user-uploaded photos,
-- categorized as man / woman / boy_child / girl_child, uploaded once via
-- the /avatars page and reused for every job.

create table public.avatar_photos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (category in ('man','woman','boy_child','girl_child')),
  storage_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

alter table public.avatar_photos enable row level security;
create policy "avatar_photos_select_own" on public.avatar_photos for select using (auth.uid() = user_id);
create policy "avatar_photos_insert_own" on public.avatar_photos for insert with check (auth.uid() = user_id);
create policy "avatar_photos_update_own" on public.avatar_photos for update using (auth.uid() = user_id);
create policy "avatar_photos_delete_own" on public.avatar_photos for delete using (auth.uid() = user_id);

-- reuses the set_updated_at() function created in 0001_init.sql
create trigger avatar_photos_set_updated_at before update on public.avatar_photos
  for each row execute function public.set_updated_at();

-- jobs: swap the three old avatar columns for one category column.
--
-- NOTE: this deletes existing rows in `jobs` first (job_events cascades via
-- its existing FK). Only throwaway test rows from debugging the pipeline
-- should exist at this point. If you want to keep them instead, skip the
-- `delete from public.jobs;` line below and manually backfill
-- avatar_category on existing rows before the ALTER, since it's NOT NULL.
delete from public.jobs;

alter table public.jobs
  drop column avatar_gender,
  drop column avatar_style,
  drop column avatar_name,
  add column avatar_category text not null check (avatar_category in ('man','woman','boy_child','girl_child'));
