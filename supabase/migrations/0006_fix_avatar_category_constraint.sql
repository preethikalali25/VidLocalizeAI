-- 0004_add_avatar_age_categories.sql guessed wrong constraint names to
-- drop (Postgres's actual auto-generated name didn't match), so it added
-- a second, wider check constraint alongside the original narrow one
-- instead of replacing it. Postgres enforces ALL check constraints at
-- once, so the old narrow one was still silently rejecting old_man/
-- old_woman even after 0004 "succeeded" with no error.
--
-- This finds and drops every check constraint on avatar_photos.category
-- and jobs.avatar_category by actual name (whatever it really is) rather
-- than guessing, then adds back a single correct wide constraint on each.

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.avatar_photos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.avatar_photos drop constraint %I', r.conname);
  end loop;

  for r in
    select conname from pg_constraint
    where conrelid = 'public.jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%avatar_category%'
  loop
    execute format('alter table public.jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.avatar_photos add constraint avatar_photos_category_check
  check (category in ('man','woman','boy_child','girl_child','old_man','old_woman'));

alter table public.jobs add constraint jobs_avatar_category_check
  check (avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman'));
