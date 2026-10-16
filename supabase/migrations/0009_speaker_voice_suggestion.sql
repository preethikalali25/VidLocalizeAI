-- Adds a Gemini-suggested avatar category per detected speaker, shown as
-- a hint in the speaker review screen (pre-selected, fully overridable) --
-- never auto-applied without the human confirming via submit-speaker-
-- assignments, same as avatar_category itself.

alter table public.job_speakers add column suggested_avatar_category text
  check (suggested_avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman'));
