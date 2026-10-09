-- Add subdivision_name to get_property_intelligence and create get_subdivisions_intelligence
DROP FUNCTION IF EXISTS get_property_intelligence CASCADE;
CREATE OR REPLACE FUNCTION get_property_intelligence(
  p_lat double precision,
  p_lon double precision,
  p_max_miles double precision default 50.0,
  p_opportunity_filter text default 'STORM',
  p_subdivision_name text default null
)
RETURNS table (
  property_id uuid,
  lead_id uuid,
  normalized_address text,
  address_line1 text,
  city text,
  owner_name text,
  owner_source text,
  roof_age_years int,
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
  primary_phone text,
  phone_status contact_verification_status,
  primary_email text,
  email_status contact_verification_status,
  last_contact_date timestamptz,
  last_visit_date timestamptz,
  distance_miles numeric,
  opportunity_type text,
  has_qualifying_storm_evidence boolean,
  lat numeric,
  lng numeric,
  subdivision_name text,
  subdivision_source text,
  subdivision_confidence text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
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
     
    greatest(
      COALESCE(pos.opportunity_score, 0),
      least(100, 
        (COALESCE(pos.max_wind, 0) * 0.5) + 
        (COALESCE(pos.max_hail, 0) * 20) + 
        (case when p.roof_age_years >= 15 then 20 else 0 end)
      )
    ) as opportunity_score,

    l.assigned_to,
    u.raw_user_meta_data->>'full_name' as assigned_to_name,
    l.status::text as lead_status,
    
    c.primary_phone,
    c.phone_verification_status as phone_status,
    c.email as primary_email,
    c.email_verification_status as email_status,
    
    l.first_contacted_at as last_contact_date,
    (select created_at from activities a where a.property_id = p.id and a.activity_type = 'door_knock' order by created_at desc limit 1) as last_visit_date,

    case
      when p_lat is not null and p_lon is not null and p.location is not null then
        ST_DistanceSphere(
          p.location::geometry,
          ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
        ) * 0.000621371
      else null
    end as distance_miles,
    
    -- Opportunity Type classification
    case 
      when pos.max_wind >= 60 and pos.max_hail >= 1.0 then 'STORM_COMBINED'
      when pos.max_hail >= 1.0 then 'STORM_HAIL'
      when pos.max_wind >= 60 then 'STORM_WIND'
      when p.roof_age_years >= 15 then 'AGING_ROOF'
      when p.last_roof_permit_date is null and p.roof_age_years is not null then 'PERMIT_GAP'
      when l.id is not null then 'MANUAL_LEAD'
      else 'NONE'
    end as opportunity_type,
    
    (pos.max_wind >= 60 or pos.max_hail >= 1.0) as has_qualifying_storm_evidence,
    
    ST_Y(p.location::geometry)::numeric as lat,
    ST_X(p.location::geometry)::numeric as lng,
    
    p.subdivision_name,
    p.subdivision_source,
    p.subdivision_confidence
    
  from properties p
  left join property_opportunity_scores pos on pos.property_id = p.id
  left join leads l on l.property_id = p.id
  left join customers c on c.id = l.customer_id
  left join auth.users u on u.id = l.assigned_to
  where (p_lat is null or p.location is null or ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), p_max_miles * 1609.34))
    and (p_subdivision_name is null or p.subdivision_name = p_subdivision_name)
    and (
      (p_opportunity_filter = 'STORM' and (pos.max_wind >= 60 or pos.max_hail >= 1.0))
      or (p_opportunity_filter = 'HAIL' and pos.max_hail >= 1.0)
      or (p_opportunity_filter = 'WIND 60+ MPH' and pos.max_wind >= 60)
      or (p_opportunity_filter = 'AGING ROOF' and p.roof_age_years >= 15)
      or (p_opportunity_filter = 'UNVISITED' and (select created_at from activities a where a.property_id = p.id and a.activity_type = 'door_knock' limit 1) is null)
      or (p_opportunity_filter = 'ASSIGNED' and l.assigned_to is not null)
      or (p_opportunity_filter = 'UNASSIGNED' and l.assigned_to is null)
      or (p_opportunity_filter = 'PERMIT GAP' and p.last_roof_permit_date is null)
      or (p_opportunity_filter = 'ALL')
    )
  order by opportunity_score desc nulls last, distance_miles asc nulls last
  limit 1000;
$$;


DROP FUNCTION IF EXISTS get_subdivisions_intelligence CASCADE;
CREATE OR REPLACE FUNCTION get_subdivisions_intelligence(
  p_lat double precision,
  p_lon double precision,
  p_max_miles double precision default 50.0,
  p_opportunity_filter text default 'ALL'
)
RETURNS table (
  subdivision_name text,
  subdivision_source text,
  distance_miles numeric,
  total_opportunities int,
  storm_leads int,
  aging_roof_leads int,
  unvisited_leads int,
  unassigned_leads int,
  phone_found int,
  email_found int,
  average_score numeric,
  top_score numeric,
  latest_storm date,
  max_wind numeric,
  max_hail numeric,
  subdivision_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  with candidates as (
    select * from get_property_intelligence(p_lat, p_lon, p_max_miles, p_opportunity_filter, null)
  )
  select 
    c.subdivision_name,
    max(c.subdivision_source) as subdivision_source,
    min(c.distance_miles) as distance_miles,
    count(*)::int as total_opportunities,
    count(case when c.has_qualifying_storm_evidence then 1 end)::int as storm_leads,
    count(case when c.opportunity_type = 'AGING_ROOF' then 1 end)::int as aging_roof_leads,
    count(case when c.last_visit_date is null then 1 end)::int as unvisited_leads,
    count(case when c.assigned_to is null then 1 end)::int as unassigned_leads,
    count(case when c.primary_phone is not null then 1 end)::int as phone_found,
    count(case when c.primary_email is not null then 1 end)::int as email_found,
    avg(c.opportunity_score) as average_score,
    max(c.opportunity_score) as top_score,
    max(c.latest_storm_date) as latest_storm,
    max(c.max_wind) as max_wind,
    max(c.max_hail) as max_hail,
    -- Simple ranking score: 0 to 100 based on density, max score, and inverse distance
    least(100, 
      count(*) * 2 + 
      max(c.opportunity_score) * 0.5 +
      greatest(0, (20 - coalesce(min(c.distance_miles), 20)) * 2)
    )::numeric as subdivision_score
  from candidates c
  where c.subdivision_name is not null
  group by c.subdivision_name
  order by subdivision_score desc nulls last
  limit 100;
$$;
