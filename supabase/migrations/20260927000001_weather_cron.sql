-- Create a cron job to automatically check weather events daily
-- Depends on pg_cron and pg_net extensions which are standard in Supabase

create extension if not exists pg_net;

select cron.schedule(
  'weather_event_monitor_job',
  '0 6 * * *', -- Run every day at 6 AM
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/weather-event-monitor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
  );
  $$
);
