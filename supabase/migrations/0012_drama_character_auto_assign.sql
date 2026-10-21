-- Mirrors 0009_speaker_voice_suggestion.sql for the script_drama
-- pipeline: a text-based guess (from the character's name and how other
-- characters refer to them) at each character's avatar category, shown
-- as a hint on the review screen and used to skip the
-- awaiting_character_avatars pause entirely when every character has a
-- confident suggestion with an uploaded photo for it -- see
-- parsing_script.ts.

alter table public.drama_characters add column suggested_avatar_category text
  check (suggested_avatar_category in ('man','woman','boy_child','girl_child','old_man','old_woman'));
