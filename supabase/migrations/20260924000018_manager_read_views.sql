-- =============================================================================
-- 0018  Read views for the manager screens
-- =============================================================================
-- Five views and one column. No new policies: every view is security_invoker,
-- so the RLS already on route_sessions, leads and lead_assignments decides who
-- sees what. A salesperson reading these gets their own rows; a manager gets the
-- organisation's. That is the permission, enforced by the server, and the front
-- end hiding a tab is not a second one.
--
-- `subdivision` moves onto properties because territory coverage is the one
-- manager question that cannot be answered without it, and until now the
-- neighbourhood name existed only on the device that built the door list.
--
-- Rollback:
--   drop view if exists org_directory, manager_assignment_log,
--     manager_assignment_rows, manager_route_rows, manager_activity_rows;
--   alter table properties drop column if exists subdivision;
-- =============================================================================

alter table properties add column if not exists subdivision text;

comment on column properties.subdivision is
  'Neighbourhood as the parish parcel record names it. Carried from the device '
  'that built the door list; the server has no other source for it.';

create index if not exists properties_subdivision_idx
  on properties (organization_id, subdivision) where subdivision is not null;

create or replace view manager_activity_rows with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.user_id,
  a.activity_type,
  a.outcome,
  a.gps_verification,
  a.gps_distance_m,
  a.gps_accuracy_m,
  a.occurred_at,
  l.client_id        as lead_client_id,
  l.status::text     as lead_status,
  l.opportunity_score,
  p.address_line1,
  p.subdivision,
  p.postal_code
from activities a
join leads l on l.id = a.lead_id
join properties p on p.id = l.property_id
where l.deleted_at is null;

comment on view manager_activity_rows is
  'Every recorded contact with the lead and property it happened at, including '
  'the GPS verdict as it was judged at the time. security_invoker.';

create or replace view manager_route_rows with (security_invoker = true) as
select
  s.id,
  s.organization_id,
  s.user_id,
  s.label,
  s.device_id,
  s.started_at,
  s.ended_at,
  s.ended_reason,
  (select count(*) from route_points rp where rp.route_session_id = s.id) as point_count,
  (select min(rp.recorded_at) from route_points rp where rp.route_session_id = s.id) as first_fix_at,
  last_point.recorded_at as last_fix_at,
  last_point.latitude,
  last_point.longitude,
  last_point.accuracy_m
from route_sessions s
left join lateral (
  select
    st_y(rp.location::geometry) as latitude,
    st_x(rp.location::geometry) as longitude,
    rp.accuracy_m,
    rp.recorded_at
  from route_points rp
  where rp.route_session_id = s.id
  order by rp.recorded_at desc
  limit 1
) last_point on true;

comment on view manager_route_rows is
  'One row per work route, with its most recent fix only. Deliberately not the '
  'full trail: a live view needs to know where somebody is now, and handing out '
  'every point of everyone''s day for a status screen is not the same question.';

create or replace view manager_assignment_rows with (security_invoker = true) as
select
  la.id,
  la.organization_id,
  la.lead_id,
  l.client_id     as lead_client_id,
  la.assigned_to,
  la.assigned_by,
  la.assigned_at,
  la.unassigned_at,
  la.lead_score_at_assignment,
  la.reason,
  l.status::text  as lead_status,
  l.last_activity_at,
  p.address_line1,
  p.subdivision
from lead_assignments la
join leads l on l.id = la.lead_id
join properties p on p.id = l.property_id;

comment on view manager_assignment_rows is
  'Assignments with the score frozen at the moment each was made. That frozen '
  'number is what makes rep performance answerable at all.';

create or replace view manager_assignment_log with (security_invoker = true) as
select
  h.id,
  h.organization_id,
  h.lead_id,
  h.assignment_id,
  h.action,
  h.assigned_to,
  h.actor,
  h.lead_score_at_assignment,
  h.reason,
  h.occurred_at,
  p.address_line1,
  p.subdivision
from lead_assignment_history h
join leads l on l.id = h.lead_id
join properties p on p.id = l.property_id;

comment on view manager_assignment_log is
  'The append-only record of every assignment decision. Written by trigger, '
  'readable by the organisation, writable by nobody.';

create or replace view org_directory with (security_invoker = true) as
select
  m.organization_id,
  m.user_id,
  m.role::text as role,
  m.is_active,
  pr.full_name
from organization_members m
left join profiles pr on pr.id = m.user_id;

comment on view org_directory is
  'Who is on the team, for putting names on the manager screens.';

revoke all on manager_activity_rows, manager_route_rows, manager_assignment_rows,
              manager_assignment_log, org_directory from anon;
grant select on manager_activity_rows, manager_route_rows, manager_assignment_rows,
                manager_assignment_log, org_directory to authenticated;
