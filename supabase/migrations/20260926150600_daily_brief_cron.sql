-- Enable required extensions
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Schedule the daily brief to run at 6:00 AM America/Chicago
select cron.schedule(
  'manager-daily-brief-cron',
  '0 11 * * *', -- 11:00 UTC is 6:00 AM CDT / 5:00 AM CST
  $cron$
    select net.http_post(
        url := current_setting('app.settings.edge_function_base_url', true) || '/manager-daily-brief',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
        ),
        body := '{}'::jsonb
    );
  $cron$
);
