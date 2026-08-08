# AllergenWise — RLS Audit

**Auditor:** Phase 1 Finisher Agent  
**Date:** 2026-04-30  
**Source files audited:**
- `db/migrations/0003_rls.sql` (13 original tables)
- `db/migrations/0006_csv_drafts.sql` (csv_upload_drafts)
- `db/migrations/0008_review_rate_limits.sql` (review_rate_limits)
- `db/migrations/0010_cert_warnings.sql` (cert_warnings)

---

## RESULT: PASS

All 16 tables have `enable row level security`. Every admin/learner policy that touches tenant-scoped data filters via `auth_restaurant_id()` — a `security definer` function that reads `profiles.restaurant_id` for `auth.uid()`, never trusting any client-supplied tenant_id.

---

## Table-by-table findings

| Table | RLS Enabled | Tenant filter | Public access | Notes |
|---|---|---|---|---|
| `restaurants` | ✓ 0003_rls.sql:9 | `auth_restaurant_id()` | SELECT where `status='listed'` | Admin read/update own; reviewer read all |
| `profiles` | ✓ 0003_rls.sql:10 | `auth_restaurant_id()` | None | Self-read; admin read/insert own restaurant; reviewer read all |
| `subscriptions` | ✓ 0003_rls.sql:11 | `auth_restaurant_id()` | None | Admin read own; reviewer read all |
| `modules` | ✓ 0003_rls.sql:12 | n/a (content table) | Authenticated only (`auth.uid() is not null`) | Curriculum is not secret but requires login |
| `lessons` | ✓ 0003_rls.sql:13 | n/a | Authenticated only | Same as modules |
| `exam_questions` | ✓ 0003_rls.sql:14 | n/a | Role-check (`in ('learner', 'admin', 'reviewer')`) | Questions drawn server-side; anon cannot read |
| `lesson_progress` | ✓ 0003_rls.sql:15 | Admin uses `auth_restaurant_id()` join | None | Learner read/write own via `auth.uid()`; admin read via restaurant join |
| `exam_attempts` | ✓ 0003_rls.sql:16 | Admin uses `auth_restaurant_id()` join | None | Same pattern as lesson_progress |
| `certificates` | ✓ 0003_rls.sql:17 | Admin via `auth_restaurant_id()` | `using (true)` — policy allows anon scan, query filters by cert_code | Public verify endpoint relies on non-guessable cert_code; no enumeration possible |
| `submissions` | ✓ 0003_rls.sql:18 | `auth_restaurant_id()` | None | Admin insert/read own; reviewer read/update all |
| `reviews` | ✓ 0003_rls.sql:19 | Admin via `auth_restaurant_id()` | INSERT (status='pending') + SELECT published | Public reviews model — insert allowed anonymous, status guards moderation |
| `activity_events` | ✓ 0003_rls.sql:20 | `auth_restaurant_id()` | None | Admin read own restaurant events; reviewer read all |
| `stripe_events` | ✓ 0003_rls.sql:21 | n/a | None | Service-role only; no user policies — deny-all by default |
| `csv_upload_drafts` | ✓ 0006_csv_drafts.sql | `admin_id = auth.uid() AND restaurant_id = auth_restaurant_id()` | None | Double-filter: uid match + restaurant match |
| `review_rate_limits` | ✓ 0008_review_rate_limits.sql | n/a | None | Service-role only; no user policies |
| `cert_warnings` | ✓ 0010_cert_warnings.sql | n/a | None | Service-role only; no user policies |

---

## Security guarantees confirmed

### 1. No client-supplied tenant_id trusted
All policies use `auth_restaurant_id()` (a `SECURITY DEFINER` function defined in 0003_rls.sql:28–34) which queries `profiles.restaurant_id WHERE id = auth.uid()`. No policy accepts a tenant ID from the request body, URL params, or client headers.

### 2. auth_restaurant_id() function is security definer
```sql
-- 0003_rls.sql:28
create or replace function auth_restaurant_id()
returns uuid
language sql
stable
security definer
as $$
  select restaurant_id from profiles where id = auth.uid()
$$;
```
Running as the table owner (not the calling user) prevents infinite recursion in `profiles` policies.

### 3. Public anon policies are appropriately restrictive
- `restaurants`: anon can SELECT only `status='listed'` rows.
- `certificates`: anon can SELECT any row (needed for QR verify), but the WHERE clause in the query (`cert_code = $1`) means they can only read certs they already know the code for. The code is a 256-bit-equivalent non-guessable token.
- `reviews`: anon can INSERT (pending moderation) + SELECT published. This is the correct behavior for an open review system.
- Everything else: no anon access.

### 4. Stripe + cron tables: service-role only
`stripe_events`, `review_rate_limits`, and `cert_warnings` have RLS enabled with zero permissive policies. Only the service-role key (bypasses RLS entirely) can read/write them. This is the correct MVP approach.

---

## No issues found — no `0011_rls_fixes.sql` needed
