-- Phase 1: Enhance Properties Table with Property Intelligence
alter table properties 
  add column if not exists last_roof_permit_date date,
  add column if not exists last_roof_permit_source text,
  add column if not exists last_roof_permit_desc text,
  add column if not exists owner_name text,
  add column if not exists owner_source text;

-- Phase 2: Create Server-Side Read Model RPC
drop function if exists get_property_intelligence;
create or replace function get_property_intelligence(
  p_lat double precision,
  p_lon double precision,
  p_max_miles double precision default 50.0
)
returns table (
  property_id uuid,
  lead_id uuid,
  normalized_address text,
  address_line1 text,
  city text,
  owner_name text,
  owner_source text,
  roof_age_years smallint,
  roof_age_source text,
  last_roof_permit_date date,
  last_roof_permit_desc text,
  last_roof_permit_source text,
  max_wind numeric,
  max_hail numeric,
  latest_storm_date date,
  storm_distance_miles numeric,
  opportunity_score numeric,
  assigned_to uuid,
  assigned_to_name text,
  lead_status text,
  has_phone boolean,
  has_email boolean,
  last_contact_date timestamptz,
  last_visit_date timestamptz,
  distance_miles numeric,
    lat double precision,
    lng double precision
  )
language sql security definer
as $$
  select
    p.id as property_id,
    l.id as lead_id,
    p.normalized_address,
    p.address_line1,
    p.city,
    p.owner_name,
    p.owner_source,
    p.roof_age_years,
    p.roof_age_source,
    p.last_roof_permit_date,
    p.last_roof_permit_desc,
    p.last_roof_permit_source,
    
    pos.max_wind,
    pos.max_hail,
    (select occurred_at::date from storm_events se 
     join property_storm_impacts psi on psi.storm_event_id = se.id 
     where psi.property_id = p.id order by occurred_at desc limit 1) as latest_storm_date,
    (select distance_meters * 0.000621371 from property_storm_impacts psi 
     where psi.property_id = p.id order by distance_meters asc limit 1) as storm_distance_miles,
    
    -- Recalculate score based on richer data
    greatest(
      COALESCE(pos.opportunity_score, 0),
      least(100, 
        (COALESCE(pos.max_wind, 0) * 0.5) + 
        (COALESCE(pos.max_hail, 0) * 20) + 
        (case when p.roof_age_years > 15 then 20 else 0 end)
      )
    ) as opportunity_score,

    l.assigned_to,
    u.raw_user_meta_data->>'full_name' as assigned_to_name,
    l.status::text as lead_status,
    
    (select primary_phone is not null from customers c where c.id = l.customer_id) as has_phone,
    (select email is not null from customers c where c.id = l.customer_id) as has_email,
    
    l.first_contacted_at as last_contact_date,
    (select created_at from activities a where a.property_id = p.id and a.activity_type = 'door_knock' order by created_at desc limit 1) as last_visit_date,

    case when p_lat is not null then
      (ST_Distance(p.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)) * 0.000621371)::numeric
    else null::numeric end as distance_miles,
    ST_Y(p.location::geometry) as lat,
    ST_X(p.location::geometry) as lng
    
  from properties p
  left join property_opportunity_scores pos on pos.property_id = p.id
  left join leads l on l.property_id = p.id
  left join auth.users u on u.id = l.assigned_to
  where (p_lat is null or ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), p_max_miles * 1609.34))
    and (pos.max_wind > 0 or pos.max_hail > 0 or l.id is not null) -- Filter down to actual opportunities
  order by opportunity_score desc nulls last, distance_miles asc nulls last
  limit 100;
$$;
