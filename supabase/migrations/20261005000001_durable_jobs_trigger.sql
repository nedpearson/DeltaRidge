begin;

create or replace function notify_durable_job()
returns trigger as $$
begin
  -- Wake up the worker function via pg_net (async HTTP POST)
  -- We don't wait for the result. Using Kong to route locally.
  perform net.http_post(
      url:='http://kong:8000/functions/v1/durable-job-worker',
      headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body:=jsonb_build_object('job_id', NEW.id)
  );
  return NEW;
exception when others then
  -- Do not fail the transaction if pg_net fails (e.g. in tests)
  return NEW;
end;
$$ language plpgsql security definer;

create trigger durable_job_inserted
after insert on durable_jobs
for each row
when (NEW.status = 'queued')
execute function notify_durable_job();

commit;
