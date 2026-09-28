-- Universal Search RPC
create or replace function public.universal_search(search_query text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with q as (
    select '%' || trim(search_query) || '%' as wild
  ),
  matched_customers as (
    select 
      'customer' as result_type,
      id,
      coalesce(first_name || ' ' || last_name, 'Unknown Contact') as title,
      coalesce(email, primary_phone, 'No contact info') as subtitle
    from customers, q
    where app.has_org_access(organization_id)
      and (
        first_name ilike q.wild 
        or last_name ilike q.wild 
        or email ilike q.wild 
        or primary_phone ilike q.wild
        or secondary_phone ilike q.wild
      )
    limit 5
  ),
  matched_properties as (
    select 
      'property' as result_type,
      id,
      address_line1 as title,
      coalesce(city || ', ' || state || ' ' || postal_code, city, '') as subtitle
    from properties, q
    where app.has_org_access(organization_id)
      and (
        address_line1 ilike q.wild
        or city ilike q.wild
        or postal_code ilike q.wild
      )
    limit 5
  ),
  matched_leads as (
    select 
      'lead' as result_type,
      l.id,
      'Lead: ' || coalesce(c.first_name || ' ' || c.last_name, p.address_line1, 'Unknown') as title,
      l.status::text as subtitle
    from leads l
    left join customers c on l.customer_id = c.id
    left join properties p on l.property_id = p.id
    cross join q
    where app.has_org_access(l.organization_id)
      and (
        c.first_name ilike q.wild 
        or c.last_name ilike q.wild 
        or c.email ilike q.wild 
        or c.primary_phone ilike q.wild
        or c.secondary_phone ilike q.wild
        or p.address_line1 ilike q.wild
      )
    limit 5
  )
  select coalesce(jsonb_agg(row_to_json(results)), '[]'::jsonb)
  from (
    select * from matched_customers
    union all
    select * from matched_properties
    union all
    select * from matched_leads
  ) results;
$$;

grant execute on function public.universal_search(text) to authenticated;
