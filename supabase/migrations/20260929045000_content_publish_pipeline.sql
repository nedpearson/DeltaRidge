-- Durable content publishing states and manager-only approval transitions.

alter table content_calendar
  drop constraint if exists content_calendar_status_check;

alter table content_calendar
  add constraint content_calendar_status_check
  check (status in (
    'draft', 'awaiting_approval', 'scheduled', 'queued', 'attempting',
    'published', 'failed', 'cancelled'
  ));

alter table content_calendar
  add column if not exists failure_reason text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

drop trigger if exists touch_content_calendar on content_calendar;
create trigger touch_content_calendar
  before update on content_calendar
  for each row execute function app.touch_updated_at();

create or replace function public.approve_content_calendar_post(
  p_post uuid,
  p_account uuid,
  p_scheduled_for timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  post_org uuid;
  asset_kind text;
  asset_copy text;
  account_active boolean;
begin
  select organization_id
    into post_org
    from content_calendar
   where id = p_post
     and status = 'awaiting_approval';

  if post_org is null then
    raise exception 'post is not awaiting approval';
  end if;

  if not app.has_org_role(post_org, array['admin', 'manager']::app_role[]) then
    raise exception 'insufficient permission';
  end if;

  if p_scheduled_for is null or p_scheduled_for <= now() then
    raise exception 'scheduled time must be in the future';
  end if;

  select ca.asset_type, ca.content
    into asset_kind, asset_copy
    from content_calendar cc
    join creative_assets ca on ca.id = cc.creative_asset_id
   where cc.id = p_post
     and ca.organization_id = post_org;

  if asset_kind is distinct from 'copy' or nullif(trim(asset_copy), '') is null then
    raise exception 'only text copy assets are currently supported by the live publisher';
  end if;

  select is_active
    into account_active
    from social_accounts
   where id = p_account
     and organization_id = post_org;

  if account_active is distinct from true then
    raise exception 'selected social account is unavailable';
  end if;

  update content_calendar
     set social_account_id = p_account,
         scheduled_for = p_scheduled_for,
         status = 'scheduled',
         approved_by = auth.uid(),
         approved_at = now(),
         failure_reason = null
   where id = p_post;
end;
$$;

revoke all on function public.approve_content_calendar_post(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.approve_content_calendar_post(uuid, uuid, timestamptz) to authenticated;

create or replace function public.retry_content_calendar_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  post_org uuid;
begin
  select organization_id
    into post_org
    from content_calendar
   where id = p_post
     and status = 'failed';

  if post_org is null then
    raise exception 'post is not in failed state';
  end if;

  if not app.has_org_role(post_org, array['admin', 'manager']::app_role[]) then
    raise exception 'insufficient permission';
  end if;

  update content_calendar
     set status = 'scheduled',
         scheduled_for = now(),
         failure_reason = null
   where id = p_post;
end;
$$;

revoke all on function public.retry_content_calendar_post(uuid) from public, anon;
grant execute on function public.retry_content_calendar_post(uuid) to authenticated;

-- Claims due work atomically. Stale attempts become claimable after 15 minutes;
-- ambiguous provider failures are still marked failed by the worker and require
-- an explicit manager retry.
create or replace function public.claim_due_social_posts(p_limit integer default 10)
returns table(post_id uuid)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with due as (
    select id
      from content_calendar
     where (
       (status = 'scheduled' and scheduled_for <= now())
       or
       (status = 'attempting' and last_attempt_at < now() - interval '15 minutes')
     )
     order by scheduled_for nulls last, created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ),
  claimed as (
    update content_calendar cc
       set status = 'attempting',
           last_attempt_at = now(),
           retry_count = retry_count + 1
      from due
     where cc.id = due.id
    returning cc.id
  )
  select id from claimed;
$$;

revoke all on function public.claim_due_social_posts(integer) from public, anon, authenticated;
grant execute on function public.claim_due_social_posts(integer) to service_role;
