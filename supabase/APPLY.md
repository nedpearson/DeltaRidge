# Applying the schema

Two routes. The first is correct engineering; the second is the two-minute one.

## Route A — Supabase CLI (recommended, tracked)

Applies each migration and records it in `supabase_migrations.schema_migrations`,
so future migrations apply incrementally instead of re-running everything.

From `C:\dev\github\business\DeltaRidge`:

```bash
npx supabase login                       # opens a browser, one time
npx supabase link --project-ref udrxvpkihkbrudvwggpr
npx supabase db push
```

`link` will ask for the database password. It is the password set when the
project was created — Dashboard > Settings > Database > "Reset database password"
if you no longer have it.

Verified from this machine: the connection pooler
(`aws-0-us-east-1.pooler.supabase.com:6543`) is reachable, so `db push` has a
working path out. The direct host `db.<ref>.supabase.co:5432` does **not**
resolve here, so if `db push` fails on connection, force the pooler:

```bash
npx supabase db push --db-url "postgresql://postgres.udrxvpkihkbrudvwggpr:<PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
```

## Route B — paste into the SQL editor

Open `supabase/apply_all.sql`, copy all of it, paste into
https://supabase.com/dashboard/project/udrxvpkihkbrudvwggpr/sql/new and press Run.

Postgres treats the whole script as one implicit transaction, so it either
applies completely or leaves the database untouched. Nothing partial.

The downside: the CLI's migration tracking table stays empty, so the next
`db push` would try to re-run these. If you take this route, follow it with
`npx supabase migration repair --status applied <each timestamp>`.

## Verifying it worked

Run this in the SQL editor afterwards:

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from pg_extension where extname = 'postgis') as postgis,
  (select count(*) from pg_policies where schemaname = 'public') as rls_policies;
```

Expect roughly 25 tables, postgis = 1, and a non-zero policy count.

Then, for real confidence, run the assertion suite in
`supabase/tests/rls_and_constraints.test.sql` — but **against a scratch database,
not this one**, since it inserts fixture rows. See `supabase/tests/README.md`.
