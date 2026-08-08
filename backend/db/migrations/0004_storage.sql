-- AllergenWise — Supabase Storage Buckets + RLS
-- Migration: 0004_storage.sql
-- Run after 0003_rls.sql.
-- Note: Bucket creation via SQL requires the Supabase storage extension.
-- Alternatively create buckets in the Supabase dashboard and only apply the RLS policies here.

-- ─── Create buckets ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'restaurant-photos',
    'restaurant-photos',
    true,       -- public-read; photos shown in directory
    5242880,    -- 5 MB max per photo
    array['image/jpeg','image/png','image/webp']
  ),
  (
    'roster-uploads',
    'roster-uploads',
    false,      -- private; CSV files processed server-side then deleted
    10485760,   -- 10 MB max
    array['text/csv','application/vnd.ms-excel','text/plain']
  ),
  (
    'certificates',
    'certificates',
    false,      -- private; access via signed URL only
    10485760,   -- 10 MB max
    array['application/pdf']
  )
on conflict (id) do nothing;

-- ─── RLS on storage.objects ───────────────────────────────────────────────────

-- restaurant-photos: public read, admin of that restaurant can write
create policy "restaurant_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'restaurant-photos');

create policy "restaurant_photos_admin_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'restaurant-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

create policy "restaurant_photos_admin_update"
  on storage.objects for update
  using (
    bucket_id = 'restaurant-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

create policy "restaurant_photos_admin_delete"
  on storage.objects for delete
  using (
    bucket_id = 'restaurant-photos'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

-- roster-uploads: only admin of that restaurant can upload; service role deletes after processing
create policy "roster_uploads_admin_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'roster-uploads'
    and auth.role() = 'authenticated'
    and auth_role() = 'admin'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

create policy "roster_uploads_admin_read"
  on storage.objects for select
  using (
    bucket_id = 'roster-uploads'
    and auth.role() = 'authenticated'
    and auth_role() = 'admin'
    and (storage.foldername(name))[1] = (
      select id::text from restaurants where id = auth_restaurant_id()
    )
  );

-- certificates: learner reads own cert, admin reads certs for their restaurant
create policy "certificates_learner_read_own"
  on storage.objects for select
  using (
    bucket_id = 'certificates'
    and auth.role() = 'authenticated'
    and (
      -- learner: cert file named after cert_code, profile_id embedded in path
      exists (
        select 1 from certificates c
        where c.pdf_storage_path = name
          and c.profile_id = auth.uid()
      )
      or
      -- admin: any cert in their restaurant
      exists (
        select 1 from certificates c
        where c.pdf_storage_path = name
          and c.restaurant_id = auth_restaurant_id()
          and auth_role() = 'admin'
      )
      or
      -- reviewer: all certs
      auth_role() = 'reviewer'
    )
  );
