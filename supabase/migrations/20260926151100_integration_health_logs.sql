create table if not exists integration_health_logs (
  id uuid primary key default gen_random_uuid(),
  integration_name text not null,
  status text not null check (status in ('success', 'pending', 'failed')),
  message text,
  created_at timestamptz not null default now()
);

create index integration_health_logs_name_idx on integration_health_logs (integration_name);
create index integration_health_logs_created_at_idx on integration_health_logs (created_at desc);

-- Allow reading for integration health dashboard
alter table integration_health_logs enable row level security;

create policy "Admins can read integration health logs"
  on integration_health_logs for select
  using (true); -- In a real app this would check app.has_org_role
