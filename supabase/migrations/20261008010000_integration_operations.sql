-- Rollback: drop integration_runs, mrms_grids, push_deliveries and push_subscriptions.
begin;
create table if not exists public.integration_runs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 integration text not null check (integration in ('contacts','mrms','push')),
 status text not null check (status in ('success','failed','not_configured')),
 detail text not null default '', created_at timestamptz not null default now()
);
create index if not exists integration_runs_recent on public.integration_runs(organization_id,integration,created_at desc);
alter table public.integration_runs enable row level security;
drop policy if exists integration_runs_read on public.integration_runs;
create policy integration_runs_read on public.integration_runs for select to authenticated
 using (organization_id in (select app.current_org_ids()));
grant select on public.integration_runs to authenticated;

create table if not exists public.mrms_grids (
 id text primary key, product text not null default 'MESH_Max_1440min',
 observed_at timestamptz not null, imported_at timestamptz not null default now(),
 bounds jsonb not null, cells jsonb not null, valid_cell_count integer not null, missing_cell_count integer not null default 0,
 source_url text not null check (source_url like 'https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/%')
);
alter table public.mrms_grids enable row level security;
drop policy if exists mrms_grids_read on public.mrms_grids;
create policy mrms_grids_read on public.mrms_grids for select to authenticated using (true);
grant select on public.mrms_grids to authenticated;

create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth_key text not null,
 active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
 using (user_id=auth.uid() and organization_id in (select app.current_org_ids()))
 with check (user_id=auth.uid() and organization_id in (select app.current_org_ids()));
grant select,insert,update,delete on public.push_subscriptions to authenticated;

create table if not exists public.push_deliveries (
 notification_id uuid not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 status text not null default 'sending' check (status in ('sending','delivered','failed','unknown')),
 delivered_at timestamptz not null default now(), primary key(notification_id,subscription_id)
);
alter table public.push_deliveries enable row level security;
-- Delivery receipts are written by the trusted worker; devices cannot forge them.
-- Lead assignments generate an in-app alert; only opted-in devices receive push.
create or replace function app.notify_lead_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare enabled boolean := true;
begin
 if new.assigned_to is null then return new; end if;
 if tg_op = 'UPDATE' then
  if new.assigned_to is not distinct from old.assigned_to then return new; end if;
 end if;
 if to_regclass('public.organization_settings') is not null then
  select coalesce((to_jsonb(s)->'notifications_settings'->>'notify_on_assignment')::boolean,true)
  into enabled from public.organization_settings s where s.organization_id=new.organization_id;
 end if;
 if coalesce(enabled,true) then
  insert into public.notifications(organization_id,user_id,title,body,priority,link_url,reference_entity,reference_id)
  values(new.organization_id,new.assigned_to,'Lead assigned to you','Open your assigned lead to review the property and next action.','medium','/leads/'||new.id,'lead',new.id);
 end if;
 return new;
end $$;
drop trigger if exists lead_assignment_notification on public.leads;
create trigger lead_assignment_notification after insert or update of assigned_to on public.leads
 for each row execute function app.notify_lead_assignment();
notify pgrst, 'reload schema';
commit;
