-- Create a trigger to call the review acquisition engine when a job is marked as closed_won or completed

-- Function to handle the webhook
create or replace function public.trigger_review_acquisition()
returns trigger as $$
begin
  -- Only trigger if the status actually changed to completed or closed_won
  if (NEW.status = 'completed' or NEW.status = 'closed_won') and (OLD.status IS DISTINCT FROM NEW.status) then
    perform net.http_post(
      url := 'http://kong:8000/functions/v1/review-acquisition-engine',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb,
      body := json_build_object(
        'type', 'UPDATE',
        'table', 'leads',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )::text
    );
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger on the leads table
drop trigger if exists on_lead_completed_trigger on public.leads;
create trigger on_lead_completed_trigger
  after update on public.leads
  for each row
  execute function public.trigger_review_acquisition();
