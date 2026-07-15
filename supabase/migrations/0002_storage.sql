-- Storage RLS for the 'job-assets' bucket.
--
-- Before running this, create the bucket first (Storage -> New bucket ->
-- name it exactly "job-assets", set it Private). This migration only adds
-- the access policies on top of it.
--
-- Path convention enforced by these policies: {user_id}/{job_id}/...
-- (the create-job Edge Function and frontend upload code must follow this
-- convention, or uploads/reads will be rejected).

create policy "job_assets_select_own" on storage.objects for select
  using (bucket_id = 'job-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "job_assets_insert_own" on storage.objects for insert
  with check (bucket_id = 'job-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "job_assets_delete_own" on storage.objects for delete
  using (bucket_id = 'job-assets' and (storage.foldername(name))[1] = auth.uid()::text);
