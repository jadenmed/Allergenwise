-- ─── Migration 0012 — Wave 2A.5 storage policy hardening ─────────────────────
--
-- F-S6 (audits/followups.md): the only consumer of the user-role-JWT
-- restaurant-photos storage bucket was app/(admin)/admin/submit/SubmitClient.tsx
-- which now uploads via POST /api/admin/upload-photo (service-role,
-- bypasses RLS). The user-role grants on restaurant-photos are dead code
-- with the same UPDATE-no-WITH-CHECK shape Wave 2A closed across the row tables.
--
-- Drop both the user-role INSERT (no longer needed) and UPDATE (no WITH CHECK,
-- would let an admin overwrite another tenant's path-encoded object via direct
-- @supabase/ssr browser client if the cookie hardening were ever reverted).
-- The DELETE policy is kept because nothing in app code DELETEs from the
-- bucket today; service-role would be used if/when needed.

drop policy if exists "restaurant_photos_admin_insert" on storage.objects;
drop policy if exists "restaurant_photos_admin_update" on storage.objects;
drop policy if exists "restaurant_photos_admin_delete" on storage.objects;

-- The bucket remains `public: true` for SELECT (directory listing photos are
-- intentionally public). Writes now go exclusively through service-role.
