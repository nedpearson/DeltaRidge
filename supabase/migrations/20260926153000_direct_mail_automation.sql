-- =============================================================================
-- Automated Direct Mail Trigger (Lob.com)
-- =============================================================================
-- Fires the direct-mail Edge Function when a lead transitions to 'won'.
-- The Edge Function is responsible for validating provider configuration
-- before dispatching. If keys are missing, it returns DRY_RUN / BLOCKED.
-- =============================================================================

create extension if not exists pg_net;

create or replace function queue_neighborhood_blast()
returns trigger
language plpgsql
security definer
as $func$
declare
  edge_function_url text;
  nearby_addresses jsonb;
  won_property record;
  target_property record;
  addresses_array jsonb[] := array[]::jsonb[];
  auth_secret text;
begin
  if NEW.status = 'won' and OLD.status is distinct from 'won' then

    -- Read the automation auth secret from Supabase Vault or config.
    -- This must be set in production via: ALTER DATABASE ... SET app.automation_secret = '...';
    -- If not set, the trigger silently skips rather than sending an unauthenticated request.
    auth_secret := coalesce(current_setting('app.automation_secret', true), '');
    if auth_secret = '' then
      raise warning 'app.automation_secret is not configured. Skipping direct mail trigger.';
      return NEW;
    end if;

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

    -- Only queue if we found neighbors
    if array_length(addresses_array, 1) > 0 then
      nearby_addresses := to_jsonb(addresses_array);

      edge_function_url := 'https://' || current_setting('request.headers', true)::json->>'host' || '/functions/v1/trigger-direct-mail';

      perform net.http_post(
        url := edge_function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || auth_secret
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
$func$;

drop trigger if exists lead_won_neighborhood_blast on leads;
create trigger lead_won_neighborhood_blast
  after update on leads
  for each row
  execute function queue_neighborhood_blast();
