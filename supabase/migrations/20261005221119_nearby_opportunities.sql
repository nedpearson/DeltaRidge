create or replace function get_nearby_opportunities(
  p_lat double precision,
  p_lon double precision,
  p_max_miles double precision default 50.0
)
returns table (
  property_id uuid,
  max_wind numeric,
  max_hail numeric,
  opportunity_score numeric,
  assigned_to text,
  address_line1 text,
  city text,
  normalized_address text,
  distance_miles numeric
)
language sql security definer
as $$
  select
    pos.property_id,
    pos.max_wind,
    pos.max_hail,
    pos.opportunity_score,
    (select l.assigned_to::text from leads l where l.property_id = pos.property_id limit 1) as assigned_to,
    p.address_line1,
    p.city,
    p.normalized_address,
    case when p_lat is not null then
      (ST_Distance(p.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)) * 0.000621371)::numeric
    else null::numeric end as distance_miles
  from property_opportunity_scores pos
  join properties p on p.id = pos.property_id
  where p_lat is null or ST_DWithin(p.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), p_max_miles * 1609.34)
  order by pos.opportunity_score desc, distance_miles asc nulls last
  limit 100;
$$;
