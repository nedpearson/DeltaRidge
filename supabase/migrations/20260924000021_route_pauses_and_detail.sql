-- =============================================================================
-- 0021  Breaks a rep took, and the full trail a manager can replay
-- =============================================================================
-- Two additions, both about not making things up.
--
-- PAUSES
--
-- A break is something the rep DECLARED. It is stored as they gave it and is
-- never inferred: the app already knows that a gap in the trail could be lunch,
-- a basement, a dead battery or a drive through a cutting, and it has no way to
-- tell those apart. Recording a gap as a break would put a number on somebody's
-- timesheet that nobody's phone supports. Paused time is therefore reported
-- separately from tracked time and from gaps, and the three are never added
-- together into one confident figure.
--
-- Stored as jsonb rather than a child table because a pause has no identity of
-- its own, is only ever read with its session, and is written by the same
-- idempotent upsert that writes the session. A child table would need its own
-- client_id, its own conflict target and its own place in the push order, for a
-- list that is usually empty and never longer than a handful.
--
-- ROUTE DETAIL
--
-- `manager_route_rows` deliberately carries only the LAST fix, because a live
-- status board should not hand out everyone's whole day. Replay is a different
-- question with a different answer, so it gets its own view, read one route at
-- a time. Same RLS either way: security_invoker, so a rep sees their own routes
-- and a manager sees the organisation's.
--
-- Rollback:
--   drop view if exists route_point_rows;
--   alter table route_sessions drop column if exists pauses;
-- Nothing below alters or drops existing data.
-- =============================================================================

alter table route_sessions
  add column if not exists pauses jsonb not null default '[]'::jsonb;

alter table route_sessions drop constraint if exists route_sessions_pauses_is_array;
alter table route_sessions
  add constraint route_sessions_pauses_is_array
  check (jsonb_typeof(pauses) = 'array');

comment on column route_sessions.pauses is
  'Breaks the rep declared, as [{at, until}]. Never inferred from the GPS: a '
  'gap in the trail is evidence of nothing and must not become paid or unpaid '
  'time on somebody''s record.';

-- ---------------------------------------------------------------------------
-- The full trail, for replaying one route
-- ---------------------------------------------------------------------------

create or replace view route_point_rows with (security_invoker = true) as
select
  rp.id,
  rp.organization_id,
  rp.route_session_id,
  rp.recorded_at,
  st_y(rp.location::geometry) as latitude,
  st_x(rp.location::geometry) as longitude,
  rp.accuracy_m,
  rp.altitude_m,
  rp.speed_mps,
  rp.heading_deg
from route_points rp;

comment on view route_point_rows is
  'Every fix of one route, for playback. Read one session at a time on purpose; '
  'the live board uses manager_route_rows, which carries only the last fix.';

revoke all on route_point_rows from anon;
grant select on route_point_rows to authenticated;
