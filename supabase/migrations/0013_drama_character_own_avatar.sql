-- Lets script_drama generate a unique AI avatar per character instead of
-- reusing the user's shared 6-category avatar_photos library -- without
-- this, every character assigned the same category (e.g. two "man"
-- characters) would be visually identical, since they'd all point at the
-- same single uploaded photo. See generating_character_avatars.ts.

alter table public.drama_characters
  add column avatar_storage_path text,
  add column avatar_prediction_id text,
  add column avatar_retry_count smallint not null default 0;
