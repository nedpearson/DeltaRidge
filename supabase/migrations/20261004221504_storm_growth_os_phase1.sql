-- =============================================================================
-- Phase 1: Storm Growth OS - Data Model & Schema Expansion
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TASK 1: Configure Wind Tiers
-- -----------------------------------------------------------------------------
create table if not exists storm_tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  tier_name text not null,
  min_wind_speed_mph smallint,
  max_wind_speed_mph smallint,
  min_hail_size_inches numeric(4,2),
  max_hail_size_inches numeric(4,2),
  priority smallint not null default 0,
  created_at timestamptz not null default now()
);

alter table storm_tiers enable row level security;
create policy storm_tiers_read on storm_tiers
  for select
  using (organization_id is null or organization_id in (select app.current_org_ids()));

create policy storm_tiers_write on storm_tiers
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

-- Insert global default tiers
insert into storm_tiers (tier_name, min_wind_speed_mph, max_wind_speed_mph, priority) values
  ('Watch', 40, 57, 1),
  ('High', 58, 74, 2),
  ('Severe', 75, 89, 3),
  ('Extreme', 90, 110, 4),
  ('Catastrophic', 111, null, 5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- TASK 2: Opportunity Scoring
-- -----------------------------------------------------------------------------
create or replace view property_opportunity_scores as
with impacts as (
  select
    psi.property_id,
    max(s.hail_size_inches) as max_hail,
    max(s.wind_speed_mph) as max_wind,
    min(psi.distance_meters) as min_distance
  from property_storm_impacts psi
  join storm_events s on s.id = psi.storm_event_id
  group by psi.property_id
)
select
  p.id as property_id,
  p.organization_id,
  i.max_hail,
  i.max_wind,
  i.min_distance,
  count(l.id) as previous_leads_count,
  least(100, greatest(0,
    coalesce(i.max_hail * 25, 0) +
    coalesce(i.max_wind * 0.5, 0) -
    coalesce(i.min_distance * 0.005, 0) +
    (count(l.id) * 10)
  ))::smallint as opportunity_score
from properties p
left join impacts i on i.property_id = p.id
left join leads l on l.property_id = p.id
group by p.id, p.organization_id, i.max_hail, i.max_wind, i.min_distance;

-- -----------------------------------------------------------------------------
-- TASK 3: Routes & GPS Verification
-- -----------------------------------------------------------------------------
alter table route_sessions
  add column if not exists total_distance_meters numeric(10,2),
  add column if not exists properties_visited_count integer;

alter table route_points
  add column if not exists location_confidence text,
  add column if not exists is_background_sync boolean not null default false;

create table if not exists property_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  route_session_id uuid references route_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- GPS verification
  gps_verified boolean not null default false,
  closest_distance_meters numeric(10,2),
  
  -- Rep reported action
  reported_action text not null,
  notes text,
  
  visited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table property_visits enable row level security;
create policy property_visits_own on property_visits
  for all
  using (user_id = auth.uid() and organization_id in (select app.current_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select app.current_org_ids()));

create policy property_visits_org_read on property_visits
  for select
  using (organization_id in (select app.current_org_ids()));

create trigger property_visits_touch
  before update on property_visits
  for each row execute function app.touch_updated_at();
