-- Create a cron job to automatically publish scheduled social posts
-- Depends on pg_cron and pg_net extensions which are standard in Supabase

create extension if not exists pg_net;

select cron.schedule(
  'publish_social_content_job',
  '* * * * *', -- Every minute
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/publish-social-content',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
  );
  $$
);
