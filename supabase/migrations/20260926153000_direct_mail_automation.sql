-- =============================================================================
-- Automated Direct Mail Trigger (Lob.com)
-- =============================================================================
-- This sets up the asynchronous webhook triggers that fire the direct-mail 
-- Edge Function whenever specific business conditions are met.
-- =============================================================================

create extension if not exists pg_net;

create or replace function queue_neighborhood_blast()
returns trigger
language plpgsql
security definer
as $func
declare
  edge_function_url text;
  nearby_addresses jsonb;
  won_property record;
  target_property record;
  addresses_array jsonb[] := array[]::jsonb[];
begin
  if NEW.status = 'won' and OLD.status is distinct from 'won' then
    
    -- Find the location of the won property
    select p.location, p.address_line1, p.city, p.state, p.zip
    into won_property
    from properties p
    where p.id = NEW.property_id;

    if won_property.location is null then
      return NEW;
    end if;

    -- Query properties within ~400 meters (0.25 miles)
    for target_property in
      select p.address_line1, p.city, p.state, p.zip
      from properties p
      where st_dwithin(p.location, won_property.location, 402.336)
        and p.id != NEW.property_id
      limit 100
    loop
      addresses_array := array_append(
        addresses_array,
        jsonb_build_object(
          'name', 'Current Resident',
          'address_line1', target_property.address_line1,
          'city', target_property.city,
          'state', target_property.state,
          'zip', target_property.zip
        )
      );
    end loop;

    -- Only send if we found neighbors
    if array_length(addresses_array, 1) > 0 then
      nearby_addresses := to_jsonb(addresses_array);

      -- Supabase edge function URL
      edge_function_url := 'https://' || current_setting('request.headers', true)::json->>'host' || '/functions/v1/trigger-direct-mail';
      
      -- Send async POST via pg_net
      -- NOTE: In production, the authorization token must be stored securely (e.g. Supabase Vault)
      -- Using a placeholder token for safety. The edge function will reject this unless configured.
      perform net.http_post(
        url := edge_function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer PENDING_CONFIGURATION_SECRET'
        ),
        body := jsonb_build_object(
          'campaign_type', 'neighborhood_blast',
          'addresses', nearby_addresses
        )
      );
    end if;
  end if;

  return NEW;
end;
$func;

drop trigger if exists lead_won_neighborhood_blast on leads;
create trigger lead_won_neighborhood_blast
  after update on leads
  for each row
  execute function queue_neighborhood_blast();
