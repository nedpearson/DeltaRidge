-- =============================================================================
-- Phase 2: Storm Matching and Opportunity Scoring
-- =============================================================================

-- 1. Match storm events to properties geospatially
create or replace function match_storm_properties(p_storm_id uuid, p_max_distance_meters numeric default 8046.72)
returns void
language plpgsql
security definer
as $$
declare
  v_storm storm_events%rowtype;
begin
  select * into v_storm from storm_events where id = p_storm_id;
  if not found then
    return;
  end if;

  insert into property_storm_impacts (organization_id, property_id, storm_event_id, distance_meters, match_method)
  select 
    p.organization_id,
    p.id,
    v_storm.id,
    ST_Distance(p.location, coalesce(v_storm.affected_area, v_storm.location)),
    case 
      when v_storm.affected_area is not null and ST_Intersects(p.location, v_storm.affected_area) then 'polygon' 
      else 'proximity' 
    end
  from properties p
  where ST_DWithin(p.location, coalesce(v_storm.affected_area, v_storm.location), p_max_distance_meters)
  on conflict (property_id, storm_event_id) do nothing;
end;
$$;

-- 2. Calculate Combined Opportunity Score
create or replace function calculate_property_opportunity_score(p_property_id uuid)
returns smallint
language plpgsql
security definer
as $$
declare
  v_score int := 0;
  v_max_wind smallint := 0;
  v_max_hail numeric := 0;
  v_min_distance numeric := 999999;
  v_lead_status text;
begin
  -- Get worst storm impacts
  select 
    max(coalesce(s.wind_speed_mph, 0)),
    max(coalesce(s.hail_size_inches, 0)),
    min(psi.distance_meters)
  into v_max_wind, v_max_hail, v_min_distance
  from property_storm_impacts psi
  join storm_events s on s.id = psi.storm_event_id
  where psi.property_id = p_property_id;

  -- Get CRM status
  select status::text into v_lead_status
  from leads
  where property_id = p_property_id
  and deleted_at is null
  order by created_at desc
  limit 1;

  -- Base score from weather
  if v_max_hail >= 2.0 then
    v_score := v_score + 50;
  elsif v_max_hail >= 1.5 then
    v_score := v_score + 40;
  elsif v_max_hail >= 1.0 then
    v_score := v_score + 30;
  end if;

  if v_max_wind >= 80 then
    v_score := v_score + 40;
  elsif v_max_wind >= 60 then
    v_score := v_score + 20;
  end if;

  if v_min_distance <= 1609 then -- 1 mile
    v_score := v_score + 10;
  elsif v_min_distance <= 3218 then -- 2 miles
    v_score := v_score + 5;
  end if;

  -- Adjust based on CRM status
  if v_lead_status in ('sold', 'lost', 'not_interested', 'do_not_contact', 'existing_customer') then
    v_score := 0;
  elsif v_lead_status = 'spoke' then
    v_score := v_score + 10;
  elsif v_lead_status in ('inspection_requested', 'appointment') then
    v_score := 100;
  end if;

  -- Clamp score
  if v_score > 100 then v_score := 100; end if;
  if v_score < 0 then v_score := 0; end if;

  -- Update lead score
  update leads
  set opportunity_score = v_score::smallint,
      score_computed_at = now()
  where property_id = p_property_id
  and deleted_at is null
  and status not in ('sold', 'lost', 'not_interested');

  return v_score::smallint;
end;
$$;
