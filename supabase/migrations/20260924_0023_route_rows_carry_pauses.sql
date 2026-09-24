-- =============================================================================
-- 0023  The manager's route list learns about breaks
-- =============================================================================
-- `manager_route_rows` was written before route_sessions had a `pauses` column,
-- so a break the rep declared reached the server, sat in the table, and was
-- invisible to the only screen that needed it. The route then read to a manager
-- as unbroken work — the exact reading pausing exists to prevent.
--
-- Same shape of mistake as 0020: a view written against the columns that existed
-- that afternoon, and a column added later that nothing thought to add to it.
-- Worth naming as a pattern rather than fixing quietly.
--
-- `create or replace` is enough here because the column is appended at the end;
-- inserting one mid-list needs a drop and recreate.
--
-- Rollback: re-run 0018's definition of manager_route_rows.
-- =============================================================================

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
  last_point.accuracy_m,
  -- Breaks the rep declared. Never inferred from a gap in the trail.
  s.pauses
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
  'One row per work route, with its most recent fix only, and the breaks the '
  'rep declared. Deliberately not the full trail: a live view needs to know '
  'where somebody is now, and handing out every point of everyone''s day for a '
  'status screen is not the same question.';
