-- 0002_storage.sql only defined select/insert/delete policies for
-- storage.objects. Postgres RLS is per-operation: ManageAvatarsPage.tsx
-- uploads avatar photos with `upsert: true` (so re-uploading a category
-- replaces the previous photo), and when that upsert hits an object that
-- already exists, it runs as an UPDATE, not an INSERT -- which had no
-- policy at all, so it was denied by RLS's default-deny with no
-- table-name-specific detail (Storage's error wrapper strips it, which is
-- why the error just said "new row violates row-level security policy").

create policy "job_assets_update_own" on storage.objects for update
  using (bucket_id = 'job-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'job-assets' and (storage.foldername(name))[1] = auth.uid()::text);
