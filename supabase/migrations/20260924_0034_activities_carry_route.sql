-- =============================================================================
-- 0034  Which route was this door knocked on?
-- =============================================================================
-- Today nothing can answer that question server-side.
--
-- `route_session_id` exists on exactly one table: route_points. A route's doors
-- are matched to it in the browser, by asking for activities whose timestamp
-- falls between the session's start and stop (see RoutePanel.readCounts). That
-- works for the rep looking at their own phone and fails for everything else:
--
--   - a manager cannot ask which doors belonged to a rep's route without
--     re-deriving the time window per rep, per session, in SQL;
--   - an end-of-day report cannot be regenerated later, because the window is
--     reconstructed rather than recorded;
--   - an activity recorded offline mid-route and synced at 9pm lands outside
--     any window the client is still holding, and silently belongs to nothing;
--   - a rep who forgets to end a route has a window that swallows the next
--     morning.
--
-- WHY A COLUMN AND NOT A `route_events` TABLE.
--
-- The obvious shape is a join table carrying route_session_id, lead_id,
-- property_id, activity_id, event_type, occurred_at, location, verification and
-- distance_to_property. Every one of those columns except the first already
-- exists on `activities`:
--
--   lead_id, property_id, activity_type, outcome, occurred_at,
--   recorded_at_location, gps_verification, gps_distance_m, gps_accuracy_m
--
-- So that table would be a second copy of a row we already have, kept in step
-- by hand, free to disagree with the original about whether a knock was
-- verified. The rule this repo already follows - activities and inspections are
-- the source of truth, nothing is duplicated to make a report easier - says to
-- add the one fact that is genuinely missing and nothing else.
--
-- The missing fact is which route the activity happened on. That is one FK.
--
-- WHAT DELIBERATELY DOES NOT GO HERE.
--
-- Arrivals, departures and stops are NOT recorded as events. They are inferred
-- from the GPS trail by features/routes/stops.ts, they are only ever as good as
-- the accuracy of the fixes underneath them, and writing an inference into a
-- table is how it stops being labelled as one. They stay derived, computed on
-- read, next to the accuracy figures that bound them.
--
-- ON DELETE SET NULL, not CASCADE. A purged route must never take a rep's
-- knocks and conversations with it - the activity is the record of work and
-- outlives the trail. route_retention_days on organizations exists precisely so
-- routes can be aged out; that must remain a safe thing to do.
-- =============================================================================

alter table activities
  add column if not exists route_session_id uuid
    references route_sessions (id) on delete set null;

comment on column activities.route_session_id is
  'The route this activity was recorded during, stamped by the client at write '
  'time from the open session. Null means no route was running - a phone call '
  'from the truck, an office follow-up, or work done before routes existed. '
  'Null is not a defect and must never be backfilled by guessing from '
  'timestamps: that would turn an inference into a recorded fact.';

-- Every route-scoped read is "this session, in time order".
create index if not exists activities_route_session_idx
  on activities (route_session_id, occurred_at)
  where route_session_id is not null;

-- =============================================================================
-- No new RLS policies.
-- =============================================================================
-- activities already carries its own org and role policies, and this column
-- adds no way to reach a row that was not already reachable. A manager who can
-- read the activity can now also see which route it belonged to; a manager who
-- cannot read it still cannot. route_sessions keeps its own policies unchanged:
-- rep writes their own, managers and admins read the organisation's.
-- =============================================================================
