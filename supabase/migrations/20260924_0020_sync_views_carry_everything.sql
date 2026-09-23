-- =============================================================================
-- 0020  The pull views learn about columns added after they were written
-- =============================================================================
-- Found by rehearsing the round trip against the live database rather than by
-- anything failing. Both views were written in 0016; `properties.subdivision`
-- arrived in 0018 and the GPS verdict columns in 0017, and neither view was
-- revisited.
--
-- The cost of that was silent, which is what makes it worth a migration of its
-- own rather than a footnote. A device that PULLED a lead — a second rep, a
-- manager, a replacement phone — got a door with no neighbourhood, so it was
-- invisible to territory coverage; and a knock with no verification class, so
-- the evidence the capturing phone collected read on screen as though none had
-- ever been gathered. Nothing errored. The information was simply dropped on
-- the way down.
--
-- Recreated rather than replaced because a column cannot be inserted into the
-- middle of a view's column list.
--
-- Rollback: recreate both from 0016.
-- =============================================================================

drop view if exists public.lead_sync_rows;

create view public.lead_sync_rows
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
  p.subdivision,
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
  'applies to the caller exactly as it would on a direct select. Carries '
  'subdivision: without it a device that pulls a lead rather than generating it '
  'has no neighbourhood for that door, and its territory coverage silently '
  'reads as unknown.';

drop view if exists public.activity_sync_rows;

create view public.activity_sync_rows
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
  a.occurred_at,
  a.gps_verification,
  a.gps_distance_m,
  a.gps_accuracy_m
from activities a
join leads l on l.id = a.lead_id
where l.deleted_at is null;

comment on view public.activity_sync_rows is
  'Activities with their lead''s client_id, so a pulled knock can be filed '
  'against the lead a device already holds. security_invoker. Carries the GPS '
  'verdict as it was judged at the time: a knock pulled onto a second device '
  'without it shows no evidence at all, which reads as though none was ever '
  'collected.';

revoke all on public.lead_sync_rows, public.activity_sync_rows from anon;
grant select on public.lead_sync_rows, public.activity_sync_rows to authenticated;
