-- Adds "old_man" and "old_woman" to the avatar category set.
--
-- These constraint names are Postgres's default auto-generated names for
-- unnamed column-level `check (...)` clauses (`{table}_{column}_check`). If
-- either ALTER errors with "constraint ... does not exist", open Table
-- Editor -> avatar_photos (or jobs) -> find the actual check constraint
-- name and substitute it below.

alter table public.avatar_photos drop constraint if exists avatar_photos_category_check;
alter table public.avatar_photos add constraint avatar_photos_category_check
  check (category in ('man','woman','boy_child','girl_child','old_man','old_woman'));

alter table public.jobs drop constraint if exists jobs_avatar_category_check;
alter table public.jobs add constraint jobs_avatar_category_check
  check (avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman'));
