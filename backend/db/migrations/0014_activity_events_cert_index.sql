-- ─── Migration 0014 — partial index for cert audit-trail lookups ───────────
--
-- Backs the canonical "show me everything that happened to cert X" query:
--   SELECT * FROM activity_events
--   WHERE payload->>'certificate_id' = $1
--   ORDER BY created_at;
--
-- Partial index — only events that actually carry a certificate_id are
-- indexed, keeping the index small. The `payload ? 'certificate_id'`
-- predicate is the JSONB containment check.

create index if not exists activity_events_certificate_id_idx
  on activity_events ((payload->>'certificate_id'))
  where payload ? 'certificate_id';
