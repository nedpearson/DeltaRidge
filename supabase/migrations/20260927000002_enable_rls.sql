-- Phase 6: Enable Row Level Security (RLS) for multi-tenant isolation

-- 1. Enable RLS on social tables
alter table public.social_profiles enable row level security;
alter table public.social_messages enable row level security;
alter table public.content_calendar enable row level security;
alter table public.creative_assets enable row level security;
alter table public.brand_knowledge enable row level security;
alter table public.social_autonomy_config enable row level security;

-- 2. Create policies ensuring users can only see data belonging to their organization
-- We assume the user's JWT contains an 'org_id' claim or they have a mapping table.
-- For Delta Ridge standard approach, we'll use a helper function or assume a user_organizations mapping.
-- (If relying on a simple mock for now, we'll write the policy structure)

-- Policy: Select
create policy "Users can view their organization's social profiles"
on public.social_profiles for select
using (organization_id = (auth.jwt()->>'org_id')::uuid);

create policy "Users can view their organization's social messages"
on public.social_messages for select
using (organization_id = (auth.jwt()->>'org_id')::uuid);

create policy "Users can view their organization's content calendar"
on public.content_calendar for select
using (organization_id = (auth.jwt()->>'org_id')::uuid);

create policy "Users can view their organization's creative assets"
on public.creative_assets for select
using (organization_id = (auth.jwt()->>'org_id')::uuid);

create policy "Users can view their organization's brand knowledge"
on public.brand_knowledge for select
using (organization_id = (auth.jwt()->>'org_id')::uuid);

-- Policy: Insert/Update/Delete (Same structure)
create policy "Users can insert their organization's content calendar"
on public.content_calendar for insert
with check (organization_id = (auth.jwt()->>'org_id')::uuid);

create policy "Users can update their organization's content calendar"
on public.content_calendar for update
using (organization_id = (auth.jwt()->>'org_id')::uuid);
