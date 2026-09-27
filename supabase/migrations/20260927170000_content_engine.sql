create table if not exists content_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  video_url text not null,
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  transcription text,
  results jsonb,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table content_engine_jobs enable row level security;

create policy "Users can view org jobs"
on content_engine_jobs for select
using (organization_id in (select organization_id from user_organizations where user_id = auth.uid()));

create policy "Users can insert org jobs"
on content_engine_jobs for insert
with check (organization_id in (select organization_id from user_organizations where user_id = auth.uid()));

create policy "Service role has full access"
on content_engine_jobs for all
using (true)
with check (true);
