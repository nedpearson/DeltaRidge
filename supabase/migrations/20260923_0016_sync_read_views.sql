-- =============================================================================
-- 0016  Read views for the field app's pull path
-- =============================================================================
-- Until now sync was one-way. Every `.select()` in the client was a `returning
-- id` after a write; nothing ever read the server back. That is not a partial
-- feature, it is a different system: a lead lived on the phone that captured it,
-- a second rep could not see the street their colleague had already walked, and
-- a wiped device was a wiped pipeline regardless of how reliably the push
-- worked.
--
-- Two views rather than direct table reads, for one reason each:
--
--   1. `properties.location` is `geography(Point)`. PostgREST serialises it as
--      hex WKB, which the client cannot turn back into a latitude without
--      shipping a WKB parser. The view does the projection in the database,
--      where the geometry functions already live.
--   2. The client keys everything on `client_id`, not on the server's `id`. An
--      activity's row carries its lead's server id; the view exposes that
--      lead's `client_id` alongside it so a pulled knock can be filed against
--      the lead the device already knows, without a second round trip per row.
--
-- `security_invoker = true` is the load-bearing option. Without it a view runs
-- as its OWNER, which would bypass every RLS policy on leads, properties and
-- customers and hand any authenticated user the whole table. With it the caller
-- is still the caller and the existing policies apply unchanged — no new policy
-- is defined here, and none should be.
--
-- Rollback: `drop view if exists public.activity_sync_rows, public.lead_sync_rows;`
-- Nothing else references them and no table is altered, so the drop is safe at
-- any time.
-- =============================================================================

create or replace view public.lead_sync_rows
with (security_invoker = true) as
select
  l.id                as remote_id,
  l.client_id,
  l.organization_id,
  l.status::text      as status,
  l.opportunity_score,
  l.assigned_to,
  l.next_action_at,
  l.next_action_note,
  l.first_contacted_at,
  l.last_activity_at,
  l.created_at,
  l.updated_at,
  p.address_line1,
  p.city,
  p.postal_code,
  -- Cast to geometry first: st_y/st_x on geography would compute on the
  -- spheroid, and for a point that is the same answer by a slower route.
  st_y(p.location::geometry) as latitude,
  st_x(p.location::geometry) as longitude,
  c.first_name        as contact_name,
  c.primary_phone     as contact_phone
from leads l
join properties p on p.id = l.property_id
left join customers c on c.id = l.customer_id
where l.deleted_at is null;

comment on view public.lead_sync_rows is
  'Leads flattened with their property and customer for the field app''s pull '
  'path. security_invoker, so row-level security on the underlying tables '
  'applies to the caller exactly as it would on a direct select.';

create or replace view public.activity_sync_rows
with (security_invoker = true) as
select
  a.id              as remote_id,
  a.client_id,
  a.organization_id,
  a.lead_id,
  l.client_id       as lead_client_id,
  a.user_id,
  a.activity_type,
  a.outcome,
  a.body,
  a.occurred_at
from activities a
join leads l on l.id = a.lead_id
where l.deleted_at is null;

comment on view public.activity_sync_rows is
  'Activities with their lead''s client_id, so a pulled knock can be filed '
  'against the lead a device already holds. security_invoker.';

-- Readable by signed-in members only. `anon` is revoked explicitly rather than
-- left to the default: these rows carry homeowner names and phone numbers.
revoke all on public.lead_sync_rows from anon;
revoke all on public.activity_sync_rows from anon;
grant select on public.lead_sync_rows to authenticated;
grant select on public.activity_sync_rows to authenticated;
