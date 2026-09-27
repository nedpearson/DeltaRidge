-- =============================================================================
-- 0017  Work routes, GPS evidence, and who was given which door
-- =============================================================================
-- Two separate things that happen to arrive together, because both are about
-- accountability and both are easy to build dishonestly.
--
-- ROUTES AND GPS
--
-- A route session is a rep deciding to start work and later deciding to stop.
-- It is NOT a background location service: there is no row here that can exist
-- without someone having pressed start, and `ended_at` closes it. That shape is
-- the privacy design, not an implementation detail — a schema that allowed
-- points outside a session would be a schema for tracking employees all day,
-- and no amount of front-end restraint would fix it.
--
-- `route_points` records what the DEVICE reported, including its own accuracy
-- estimate, and nothing is ever written that the device did not report. There
-- is deliberately no interpolation column, no "inferred travel", no snapping to
-- roads: a gap in the points is a gap in the evidence, and the app has to say
-- so rather than drawing a line across it.
--
-- Retention is configurable per organisation and enforced by a function, not a
-- promise. Location history is the most sensitive thing this system will ever
-- hold and it should not accumulate for ever by default.
--
-- ASSIGNMENT
--
-- `lead_score_at_assignment` is NOT NULL and cannot be changed afterwards. Six
-- months from now the only question worth asking about a rep is whether they
-- close better than the doors they were given would predict, and that question
-- is unanswerable if the score is read live: scores are recomputed every run,
-- so a live read would compare today's number against last spring's outcome.
-- Freezing it at the moment of assignment is the whole point of the table.
--
-- Rollback:
--   drop table if exists lead_assignment_history, lead_assignments,
--                        route_points, route_sessions cascade;
--   drop function if exists app.purge_expired_route_points();
--   drop function if exists app.freeze_lead_assignment_facts();
--   alter table organizations drop column if exists route_retention_days;
--   alter table activities drop column if exists gps_verification,
--     drop column if exists gps_distance_m, drop column if exists gps_accuracy_m;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Route sessions
-- ---------------------------------------------------------------------------

create table if not exists route_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Generated on the device before the server sees it, like every other row the
  -- field app writes, so a retried push updates rather than duplicating.
  client_id       uuid not null default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  device_id       text,
  label           text,
  started_at      timestamptz not null,
  -- Null means the rep has not stopped yet. It does not mean "still walking".
  ended_at        timestamptz,
  -- What the rep chose, not what the app decided for them.
  ended_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint route_sessions_org_client_unique unique (organization_id, client_id),
  constraint route_sessions_ends_after_start check (ended_at is null or ended_at >= started_at)
);

create index if not exists route_sessions_org_started_idx
  on route_sessions (organization_id, started_at desc);
create index if not exists route_sessions_user_started_idx
  on route_sessions (user_id, started_at desc);

comment on table route_sessions is
  'One deliberate stretch of door-knocking, opened and closed by the rep. No '
  'location may be recorded outside one of these.';

-- ---------------------------------------------------------------------------
-- Route points
-- ---------------------------------------------------------------------------

create table if not exists route_points (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  route_session_id uuid not null references route_sessions (id) on delete cascade,
  recorded_at      timestamptz not null,
  location         geography(Point, 4326) not null,
  -- The device's own estimate, in metres, carried through untouched. Every
  -- claim this system makes about where somebody was is bounded by this number
  -- and must never be stated more precisely than it allows.
  accuracy_m       real,
  altitude_m       real,
  speed_mps        real,
  heading_deg      real,
  created_at       timestamptz not null default now(),
  constraint route_points_org_client_unique unique (organization_id, client_id),
  constraint route_points_accuracy_sane check (accuracy_m is null or accuracy_m >= 0)
);

create index if not exists route_points_session_time_idx
  on route_points (route_session_id, recorded_at);
create index if not exists route_points_org_time_idx
  on route_points (organization_id, recorded_at);
create index if not exists route_points_gix on route_points using gist (location);

comment on column route_points.accuracy_m is
  'The radius the device itself reported, in metres. No statement about where a '
  'rep was may be made more precisely than this allows.';

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists route_retention_days integer not null default 90;

alter table organizations
  drop constraint if exists organizations_route_retention_sane;
alter table organizations
  add constraint organizations_route_retention_sane
  check (route_retention_days between 1 and 3650);

comment on column organizations.route_retention_days is
  'How long raw GPS points are kept. Enforced by app.purge_expired_route_points, '
  'which is expected to run on a schedule.';

create or replace function app.purge_expired_route_points()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  removed integer := 0;
  n integer;
  org record;
begin
  for org in select id, route_retention_days from organizations loop
    delete from route_points
    where organization_id = org.id
      and recorded_at < now() - make_interval(days => org.route_retention_days);
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  return removed;
end $$;

comment on function app.purge_expired_route_points() is
  'Deletes GPS points past their organisation''s retention window. Points only; '
  'the sessions themselves are the record that work happened and are kept.';

revoke all on function app.purge_expired_route_points() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- How good the GPS evidence for a knock was
-- ---------------------------------------------------------------------------
-- Recorded as a named class rather than a boolean, because "was the rep really
-- there" has four honest answers and only one of them is "no evidence either
-- way". A missing fix and a fix that puts them down the street are different
-- facts and must not collapse into the same word.

alter table activities
  add column if not exists gps_verification text,
  add column if not exists gps_distance_m real,
  add column if not exists gps_accuracy_m real;

alter table activities drop constraint if exists activities_gps_verification_known;
alter table activities
  add constraint activities_gps_verification_known
  check (gps_verification is null or gps_verification in
    ('verified', 'probable', 'unverified', 'gps_unavailable'));

comment on column activities.gps_verification is
  'verified: a fix inside the property, within its own accuracy. probable: '
  'close, or accurate enough only to say close. unverified: a fix that does not '
  'place the rep at this door. gps_unavailable: no fix at all, which is not an '
  'accusation - basements, garages and dead phones are ordinary.';

-- ---------------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------------

create table if not exists lead_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  lead_id          uuid not null references leads (id) on delete cascade,
  assigned_to      uuid not null references auth.users (id) on delete cascade,
  assigned_by      uuid references auth.users (id) on delete set null,
  assigned_at      timestamptz not null default now(),
  unassigned_at    timestamptz,
  -- Frozen. See the header: a live score makes rep performance unanswerable.
  lead_score_at_assignment smallint not null,
  score_computed_at timestamptz,
  -- Why this rep got this door, in words a person can argue with.
  reason           text,
  created_at       timestamptz not null default now(),
  constraint lead_assignments_org_client_unique unique (organization_id, client_id),
  constraint lead_assignments_score_range check (lead_score_at_assignment between 0 and 100),
  constraint lead_assignments_ends_after_start
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- One live assignment per lead. Two reps sent to the same door is a scheduling
-- bug that should fail loudly here rather than quietly in a driveway.
create unique index if not exists lead_assignments_one_active_per_lead
  on lead_assignments (lead_id) where unassigned_at is null;

create index if not exists lead_assignments_assignee_idx
  on lead_assignments (assigned_to, assigned_at desc);
create index if not exists lead_assignments_org_idx
  on lead_assignments (organization_id, assigned_at desc);

/**
 * The facts that make an assignment worth recording cannot be edited later.
 *
 * Closing one out is an UPDATE of `unassigned_at`, so the table cannot be made
 * append-only outright. Instead every column that a performance question
 * depends on is frozen, and only the closing timestamp may move.
 */
create or replace function app.freeze_lead_assignment_facts()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.lead_id is distinct from old.lead_id
     or new.assigned_to is distinct from old.assigned_to
     or new.assigned_at is distinct from old.assigned_at
     or new.lead_score_at_assignment is distinct from old.lead_score_at_assignment
     or new.organization_id is distinct from old.organization_id
     or new.client_id is distinct from old.client_id then
    raise exception
      'lead_assignments is a record of what was decided: only unassigned_at and reason may change';
  end if;
  return new;
end $$;

drop trigger if exists lead_assignments_freeze on lead_assignments;
create trigger lead_assignments_freeze
  before update on lead_assignments
  for each row execute function app.freeze_lead_assignment_facts();

/**
 * The append-only log.
 *
 * Separate from the table above because that one answers "who has this door
 * now" and gets closed out, while this one answers "what has ever been decided
 * about this door" and is never touched again. Written by a trigger rather than
 * by the client, so a client that forgets cannot create a gap.
 */
create table if not exists lead_assignment_history (
  id               bigserial primary key,
  organization_id  uuid not null references organizations (id) on delete cascade,
  lead_id          uuid not null references leads (id) on delete cascade,
  assignment_id    uuid not null,
  action           text not null check (action in ('assigned', 'unassigned')),
  assigned_to      uuid,
  actor            uuid,
  lead_score_at_assignment smallint not null,
  reason           text,
  occurred_at      timestamptz not null default now()
);

create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_org_idx
  on lead_assignment_history (organization_id, occurred_at desc);

create or replace function app.log_lead_assignment()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'assigned', new.assigned_to,
       new.assigned_by, new.lead_score_at_assignment, new.reason, new.assigned_at);
  elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'unassigned', new.assigned_to,
       auth.uid(), new.lead_score_at_assignment, new.reason, new.unassigned_at);
  end if;
  return new;
end $$;

drop trigger if exists lead_assignments_log on lead_assignments;
create trigger lead_assignments_log
  after insert or update on lead_assignments
  for each row execute function app.log_lead_assignment();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table route_sessions enable row level security;
alter table route_points enable row level security;
alter table lead_assignments enable row level security;
alter table lead_assignment_history enable row level security;

-- A rep writes their OWN route and nobody else's. Managers and admins read the
-- organisation's; a salesperson reading a colleague's movements is not a
-- feature anyone asked for.
drop policy if exists route_sessions_own_write on route_sessions;
create policy route_sessions_own_write on route_sessions
  for all
  using (user_id = auth.uid() and organization_id in (select app.current_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select app.current_org_ids()));

drop policy if exists route_sessions_manager_read on route_sessions;
create policy route_sessions_manager_read on route_sessions
  for select
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists route_points_own_write on route_points;
create policy route_points_own_write on route_points
  for all
  using (exists (
    select 1 from route_sessions s
    where s.id = route_points.route_session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from route_sessions s
    where s.id = route_points.route_session_id
      and s.user_id = auth.uid()
      and s.organization_id = route_points.organization_id
  ));

drop policy if exists route_points_manager_read on route_points;
create policy route_points_manager_read on route_points
  for select
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- Everyone in the organisation sees who has which door; only a manager or admin
-- decides it. Server-enforced, because hiding the button is not a permission.
drop policy if exists lead_assignments_read on lead_assignments;
create policy lead_assignments_read on lead_assignments
  for select using (organization_id in (select app.current_org_ids()));

drop policy if exists lead_assignments_manager_write on lead_assignments;
create policy lead_assignments_manager_write on lead_assignments
  for insert
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists lead_assignments_manager_close on lead_assignments;
create policy lead_assignments_manager_close on lead_assignments
  for update
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- The log is readable by the organisation and writable by nobody: it has no
-- INSERT, UPDATE or DELETE policy at all, so only the trigger can add to it.
drop policy if exists lead_assignment_history_read on lead_assignment_history;
create policy lead_assignment_history_read on lead_assignment_history
  for select using (organization_id in (select app.current_org_ids()));

drop trigger if exists route_sessions_touch on route_sessions;
create trigger route_sessions_touch
  before update on route_sessions
  for each row execute function app.touch_updated_at();
