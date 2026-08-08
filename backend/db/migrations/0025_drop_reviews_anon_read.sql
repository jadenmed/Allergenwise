-- AllergenWise — Remove the anonymous public-read policy on reviews
-- Migration: 0025_drop_reviews_anon_read.sql
-- Idempotent: drop policy IF EXISTS. Safe to re-run.
--
-- T-35 drops `reviews_public_read_published`, created in 0003_rls.sql:309 as
--
--     create policy "reviews_public_read_published"
--       on reviews for select
--       using (status = 'published');
--
-- Three properties made that the widest read grant in the database:
--
--   1. NO IDENTITY CHECK. The policy was created without a TO clause, so it
--      applied to `public` — every role, `anon` included. The Supabase anon key
--      is a publishable credential that ships to any browser that asks for it,
--      so RLS was the only barrier behind it. This was the sole genuinely
--      anon-readable policy in the schema.
--
--   2. NO COLUMN RESTRICTION. Postgres RLS filters ROWS, never COLUMNS. A SELECT
--      policy on `reviews` therefore grants every column of every matching row,
--      and `reviews.author_email` (0001_init.sql:250) is one of them. The
--      predicate `status = 'published'` reads like it scopes the exposure; it
--      does not. It selects which people's email addresses are readable, not
--      which fields. An anonymous caller could enumerate the email address of
--      every person who has ever left a published review.
--
--   3. NOTHING USED IT. All five `.from('reviews')` call sites are server-only
--      route handlers holding a service-role client, and service-role bypasses
--      RLS outright:
--
--        app/api/reviewer/reviews/queue/route.ts:59        createServiceSupabase()
--        app/api/reviewer/reviews/[id]/decide/route.ts:82  createServiceSupabase()
--        app/api/directory/[slug]/route.ts:110             createServiceDb()
--        app/api/reviews/submit/route.ts:147               createServiceDb()
--
--      The public directory page is the only surface that renders reviews, and
--      it reads them at app/api/directory/[slug]/route.ts:148 selecting
--      `id, author_name, rating, body, allergen_context, created_at` — no email
--      column, on a client that never consulted this policy. The submit route's
--      insert at :214 does not chain `.select()`, so it returns no row and needs
--      no SELECT grant either. Dropping this policy is invisible to every
--      rendered surface.
--
-- Decision recorded 2026-07-30 in
-- VAULT/Decisions/Drop the anonymous public-read policy on reviews (T-35).md.

drop policy if exists "reviews_public_read_published" on reviews;

-- What deliberately SURVIVES. `reviews` must not end up with zero read policies
-- — that would be a different bug, and would break the reviewer queue. After
-- this migration the table carries exactly three policies, all identity-scoped:
--
--   reviews_manager_read_own_restaurant  SELECT  0022_rename_admin_to_manager.sql:207
--   reviews_reviewer_read_all            SELECT  0003_rls.sql:322
--   reviews_public_insert                INSERT  0003_rls.sql:304
--
-- (0003 also created reviews_reviewer_update_all; 0011_rls_hardening.sql:67
-- already dropped it. It is absent before this migration, not because of it.)
--
-- Assert that shape rather than trusting it, so a future migration that removes
-- a survivor fails here instead of in production.

do $$
declare
  missing text;
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'reviews'
       and policyname = 'reviews_public_read_published'
  ) then
    raise exception
      'migration 0025: reviews_public_read_published still present after DROP POLICY'
      using hint = 'A later migration must be re-creating it. Anonymous read of reviews.author_email is live.';
  end if;

  select string_agg(expected, ', ' order by expected)
    into missing
    from (
      values
        ('reviews_manager_read_own_restaurant'),
        ('reviews_reviewer_read_all'),
        ('reviews_public_insert')
    ) as e(expected)
   where not exists (
     select 1 from pg_policies
      where schemaname = 'public'
        and tablename  = 'reviews'
        and policyname = e.expected
   );

  if missing is not null then
    raise exception
      'migration 0025: expected reviews policies missing after DROP POLICY: %', missing
      using hint = 'Only reviews_public_read_published should have been removed. Reviewers read the moderation queue through reviews_reviewer_read_all; managers read their own restaurant through reviews_manager_read_own_restaurant.';
  end if;
end $$;
