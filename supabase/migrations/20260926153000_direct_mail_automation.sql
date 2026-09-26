-- =============================================================================
-- Automated Direct Mail Trigger (Lob.com)
-- =============================================================================
-- This sets up the asynchronous webhook triggers that fire the direct-mail 
-- Edge Function whenever specific business conditions are met.
-- =============================================================================

-- Enable the pg_net extension if it is not already active
create extension if not exists pg_net;

create or replace function queue_neighborhood_blast()
returns trigger
language plpgsql
security definer
as $func
declare
  edge_function_url text;
  auth_header text;
  nearby_addresses jsonb;
begin
  -- Only trigger when a lead is officially marked 'won'
  if NEW.status = 'won' and OLD.status is distinct from 'won' then
    
    -- In a full implementation, this query would find all properties within 
    -- 0.25 miles of the sold property. For this trigger, we mock the payload 
    -- format that the edge function expects.
    nearby_addresses := jsonb_build_array(
      jsonb_build_object(
        'name', 'Current Resident',
        'address_line1', 'Neighbor of ' || NEW.id, -- Placeholder
        'city', 'Local',
        'state', 'TX',
        'zip', '78701'
      )
    );

    -- Retrieve webhook credentials from vault or environment (mocked here for structure)
    -- Supabase provides edge functions at a deterministic URL structure
    edge_function_url := 'https://' || current_setting('request.headers')::json->>'host' || '/functions/v1/trigger-direct-mail';
    
    -- Send async POST via pg_net
    perform net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        -- In production, inject actual service role key here securely
        'Authorization', 'Bearer MOCK_SERVICE_KEY'
      ),
      body := jsonb_build_object(
        'campaign_type', 'neighborhood_blast',
        'addresses', nearby_addresses
      )
    );
  end if;

  return NEW;
end;
$func;

drop trigger if exists lead_won_neighborhood_blast on leads;
create trigger lead_won_neighborhood_blast
  after update on leads
  for each row
  execute function queue_neighborhood_blast();
