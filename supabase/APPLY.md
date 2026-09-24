# Applying the schema

> ## Read this before running anything against `udrxvpkihkbrudvwggpr`
>
> **The production database is already fully applied. Do not run either route
> against it.** Verified 2026-09-24: every table, view and function the 35
> migration files create exists — 59 tables, 15 views, 79 RLS policies, PostGIS
> present, zero missing objects.
>
> **`supabase db push` would fail against it.** The CLI derives a migration
> version from the filename, and these files are named `20260924_0034_name.sql`
> — the CLI reads `20260924`, while the recorded history holds 14-digit
> timestamps (`20260924204246`) written by the MCP tooling that actually applied
> them. Nothing matches, so `db push` would try to re-apply migration 0001 and
> stop on `create type app_role` — that type already exists, and the early
> migrations guard `create table` and `create policy` but not `create type` or
> `create trigger`.
>
> To make `db push` usable again, reconcile the history first:
> `npx supabase migration repair --status applied <version>` for each of the 30
> recorded versions. Until that is done, apply new schema through the same
> tooling that applied the last 23 migrations.
>
> The routes below are correct for a **fresh** database — a scratch project, a
> local `supabase start` stack, or a new environment.

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

`apply_all.sql` is a mechanical concatenation of every file in
`supabase/migrations/`, in filename order. **Regenerate it whenever a migration
is added** — it was found on 2026-09-24 to have been generated on 2026-09-20 and
to stop at migration 0012, leaving 23 files out. A fresh install from that
version would have had no routes, no manager views, no grading, no Roofr, and
none of the security fixes in 0032 — including the one that closed an anonymous
cross-tenant write into `estimate_items`.

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

As of 2026-09-24 the production database returns **59 tables, 15 views, 79
policies, postgis = 1**. "Roughly 25 tables" was the expectation when this was
written at migration 0012 and is no longer the number to check against.

### Regenerating apply_all.sql

Do this in the same commit as any new migration, or Route B silently installs a
schema that is missing it:

```powershell
$out = New-Object System.Text.StringBuilder
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")
[void]$out.AppendLine("-- Delta Ridge - all migrations, concatenated for one-shot application.")
[void]$out.AppendLine("-- Generated $stamp from supabase/migrations/.")
[void]$out.AppendLine("-- Source of truth is the individual migration files; prefer 'supabase db push'.")
[void]$out.AppendLine("-- Postgres runs this as a single implicit transaction: it applies fully or not at all.")
foreach ($f in Get-ChildItem supabase\migrations\*.sql | Sort-Object Name) {
  [void]$out.AppendLine("")
  [void]$out.AppendLine("-- =================================================================")
  [void]$out.AppendLine("-- $($f.Name)")
  [void]$out.AppendLine("-- =================================================================")
  [void]$out.AppendLine((Get-Content $f.FullName -Raw).TrimEnd())
}
# UTF8 WITHOUT a BOM - PowerShell's -Encoding UTF8 adds one, and a BOM at the
# top of a pasted script is a parse error waiting to happen.
$noBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("$PWD\supabase\apply_all.sql", $out.ToString(), $noBom)
```

Then check every migration made it in:

```powershell
Get-ChildItem supabase\migrations\*.sql | Where-Object {
  (Select-String -Path supabase\apply_all.sql -Pattern $_.Name -SimpleMatch).Count -eq 0
} | ForEach-Object { "MISSING $($_.Name)" }
```

Then, for real confidence, run the assertion suite in
`supabase/tests/rls_and_constraints.test.sql` — but **against a scratch database,
not this one**, since it inserts fixture rows. See `supabase/tests/README.md`.
