-- Create cron job for autonomous ad buying
create extension if not exists pg_net;

select cron.schedule(
  'autonomous_ad_buyer_job',
  '0 * * * *', -- Run every hour
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/autonomous-ad-buyer',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
  );
  $$
);
