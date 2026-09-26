-- =============================================================================
-- 0039  Lead pull carries contact provenance and email
-- =============================================================================
-- A second device must not turn a provider/marketing number into
-- "homeowner gave it at the door" merely because provenance was omitted from
-- the flattened sync view. Null stays unknown.
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
  c.primary_phone     as contact_phone,
  c.email             as contact_email,
  c.phone_source      as contact_source
from leads l
join properties p on p.id = l.property_id
left join customers c on c.id = l.customer_id
where l.deleted_at is null;

revoke all on public.lead_sync_rows from anon;
grant select on public.lead_sync_rows to authenticated;

comment on view public.lead_sync_rows is
  'Flattened lead/property/customer row for field pull. Carries contact source '
  'and email so a second device preserves provenance rather than upgrading an '
  'unknown/provider number into homeowner-provided contact.';
