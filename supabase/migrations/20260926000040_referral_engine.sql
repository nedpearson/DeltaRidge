-- 0040 Referral Engine
-- Automatically generates highly-scored neighbor leads when a property is sold.

-- 1. Create the RPC that finds adjacent properties and promotes them to leads
-- Expose to GraphQL / Postgrest
create or replace function promote_neighbors_of_sale(sold_lead_id uuid)
returns void
language plpgsql security definer
as $$
declare
  sold_lead record;
  neighbor_record record;
  new_lead_id uuid;
begin
  -- Get the sold lead's geometry and org
  select * into sold_lead from leads where id = sold_lead_id;
  if not found then return; end if;

  -- Find properties within ~100 meters that are NOT already leads
  for neighbor_record in
    select p.*
    from properties p
    where p.organization_id = sold_lead.organization_id
      and st_dwithin(p.location, sold_lead.location, 100)
      and p.id != coalesce(sold_lead.property_id, uuid_nil())
      and not exists (
        select 1 from leads l 
        where l.property_id = p.id 
          and l.organization_id = p.organization_id
      )
    limit 8
  loop
    -- Promote property to lead
    insert into leads (
      organization_id,
      property_id,
      address,
      latitude,
      longitude,
      score,
      reasons,
      status
    ) values (
      sold_lead.organization_id,
      neighbor_record.id,
      neighbor_record.address,
      neighbor_record.latitude,
      neighbor_record.longitude,
      95, -- Extremely high score for neighbor of sale
      array['Neighbor of recent sale (' || sold_lead.address || ')'],
      'open'
    );
  end loop;
end;
$$;
