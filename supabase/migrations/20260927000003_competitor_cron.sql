-- Create competitor intelligence table
create table public.competitor_ad_intelligence (
    id uuid primary key default gen_random_uuid(),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    organization_id uuid references public.organizations(id) not null,
    competitor_name text not null,
    platform text not null,
    ad_content text not null,
    threat_level text not null,
    notes text
);

alter table public.competitor_ad_intelligence enable row level security;

create policy "Users can view their organization's competitor intelligence"
on public.competitor_ad_intelligence for select
using (app.has_org_access(organization_id));

-- Create cron job for competitor intelligence
create extension if not exists pg_net;

select cron.schedule(
  'competitor_ad_intelligence_job',
  '0 2 * * 0', -- Run weekly on Sunday at 2 AM
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/competitor-intelligence-scraper',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
  );
  $$
);
