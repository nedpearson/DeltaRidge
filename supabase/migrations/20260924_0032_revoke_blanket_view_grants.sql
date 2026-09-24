-- =============================================================================
-- 0032  Take the write grants off the views nobody meant to hand out
-- =============================================================================
-- Found by auditing the live database against these migrations. The two files
-- disagreed, and the live one was wrong.
--
-- 0011 created the sales-safe estimate projections and granted exactly what it
-- meant to:
--
--     grant select on estimate_versions_sales to authenticated;
--     grant select on estimate_items_sales   to authenticated;
--
-- The live database had INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER on both, for `authenticated` AND for `anon`. Nothing in this repo
-- asked for that. It comes from Supabase's default privileges on the `public`
-- schema, which hand `anon` and `authenticated` ALL on every new table-like
-- object created by `postgres` — a view included, the moment it is created.
--
-- WHY THAT WAS SERIOUS, precisely.
--
-- The two *_sales views are deliberately `security_invoker = false` (see the
-- comment above them in 0011, and leave it that way). Base-table RLS on
-- estimate_items/estimate_versions restricts SELECT to admin and manager; the
-- definer view is what lets a SALES REP read a projection with the cost columns
-- dropped. That design is sound and stays.
--
-- But a definer view runs as its owner, `postgres`, for writes too. Both views
-- are single-table with a WHERE, so Postgres makes them automatically
-- updatable (information_schema.views said is_insertable_into = YES), and
-- neither was created WITH CHECK OPTION (check_option = NONE). Put together:
--
--   POST /rest/v1/estimate_items_sales  { "organization_id": "<any org>", ... }
--
-- with nothing but the anon key — which is public by design, ships in the
-- browser bundle, and sits in a public repo — inserted a forged row straight
-- into estimate_items, as postgres, bypassing RLS, into ANY organisation.
-- CHECK OPTION being absent is what allowed a foreign organization_id; the
-- definer property is what bypassed the policy that would have caught it.
--
-- Reads were never exposed: the views filter on app.current_org_ids(), which
-- is `where user_id = auth.uid()`, and auth.uid() is null for anon, so an
-- unauthenticated SELECT returned zero rows. This was a write hole, not a
-- read hole. Fixing the write grants closes it without touching the design.
--
-- The other views in this file are the same blanket-grant accident with a much
-- smaller blast radius: they are security_invoker (so a write through them is
-- still checked against base-table RLS as the calling user) and were never
-- granted to anon. Revoked anyway — every one of them is a read projection,
-- verified against src/: all thirteen are only ever `.select()`ed.
--
-- Not touched here: geometry_columns and geography_columns carry the same
-- blanket grants, but they are PostGIS catalog views, not auto-updatable, and
-- owned by the extension. Revoking on them risks the extension for no gain.
-- =============================================================================

-- --- The actual vulnerability -------------------------------------------------
-- anon has no business touching these at all. Revoke everything, including the
-- SELECT that returned nothing anyway, so least privilege is the stated intent
-- rather than an accident of auth.uid() being null.
revoke all on public.estimate_versions_sales from anon;
revoke all on public.estimate_items_sales   from anon;

-- authenticated keeps SELECT and loses the rest. This is what 0011 intended.
revoke insert, update, delete, truncate, references, trigger
  on public.estimate_versions_sales from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.estimate_items_sales   from authenticated;

grant select on public.estimate_versions_sales to authenticated;
grant select on public.estimate_items_sales   to authenticated;

-- --- Least privilege on the remaining read projections -------------------------
do $$
declare
  v text;
begin
  foreach v in array array[
    'activity_sync_rows',
    'lead_sync_rows',
    'lead_trace',
    'manager_activity_rows',
    'manager_assignment_log',
    'manager_assignment_rows',
    'manager_lead_followups',
    'manager_route_rows',
    'org_directory',
    'roofr_sync_log',
    'route_point_rows'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated',
      v
    );
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$$;

-- --- Stop it happening again ---------------------------------------------------
-- The root cause is a DEFAULT privilege, so every future view created by
-- postgres in this schema starts wide open again. Narrow the default to SELECT
-- so a new read projection is born read-only. A table that genuinely needs
-- writes still gets them the normal way: an explicit grant, in a migration,
-- where it can be read and reviewed.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

comment on view public.estimate_items_sales is
  'Sales-safe projection of estimate_items with cost columns dropped. '
  'Deliberately SECURITY DEFINER (security_invoker = false) so a sales rep can '
  'read it even though base-table RLS limits SELECT to admin/manager — do not '
  '"fix" the security_definer_view lint by flipping it. SELECT to authenticated '
  'only; write grants were revoked in 0032 and must never be re-added, because '
  'a definer view without CHECK OPTION is an RLS bypass on insert.';

comment on view public.estimate_versions_sales is
  'Sales-safe projection of estimate_versions with cost columns dropped. '
  'Deliberately SECURITY DEFINER (security_invoker = false) so a sales rep can '
  'read it even though base-table RLS limits SELECT to admin/manager — do not '
  '"fix" the security_definer_view lint by flipping it. SELECT to authenticated '
  'only; write grants were revoked in 0032 and must never be re-added, because '
  'a definer view without CHECK OPTION is an RLS bypass on insert.';
