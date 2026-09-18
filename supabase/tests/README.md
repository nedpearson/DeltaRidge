# Database verification

`rls_and_constraints.test.sql` proves the guarantees the schema claims, against a
real Postgres with PostGIS. It is not a smoke test: each case asserts a security
or data-integrity property that the application depends on and that is easy to
break silently during a refactor.

Run it against a throwaway database:

```bash
createdb dr_test
psql -d dr_test -v ON_ERROR_STOP=1 \
  -c 'create extension if not exists pgcrypto;' \
  -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -d dr_test -v ON_ERROR_STOP=1 -q -f "$f" || exit 1
done
psql -d dr_test -f supabase/tests/rls_and_constraints.test.sql
```

`00_supabase_stub.sql` provides the pieces Supabase supplies in production — the
`auth` schema, `auth.users`, `auth.uid()`, and the `authenticated`/`anon`/
`service_role` roles — so migrations run locally exactly as they will hosted.

Last run: 2026-09-18 against PostgreSQL 16.15 + PostGIS 3. All 9 cases passed.

| # | Property asserted |
| --- | --- |
| 1 | RLS isolates organizations; a rep at another company sees none of Delta Ridge's properties |
| 2 | Duplicate addresses are rejected, insensitive to punctuation |
| 3 | Licensed storm geometry cannot be persisted, enforced in the database |
| 4 | Taking a photo satisfies its checklist item automatically |
| 5 | A photo flagged for retake does NOT satisfy the requirement |
| 6 | A double-tapped handoff cannot create a second CompanyCam/Roofr job |
| 7 | Only one live handoff exists per inspection |
| 8 | The audit log is not writable from a client role |
| 9 | PostGIS proximity search finds storms near a property |
