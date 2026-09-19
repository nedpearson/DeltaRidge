-- -----------------------------------------------------------------------------
-- 0007 — Invite-based membership provisioning.
--
-- The site is publicly reachable, so "first user becomes admin" is not safe: a
-- stranger who signed up before the owner would own the organisation. Instead an
-- admin (or a seed migration) records an invite against an email address, and
-- the existing on_auth_user_created trigger grants membership when, and only
-- when, a user appears with that address.
--
-- Auth is magic-link only (signInWithOtp). There are no passwords anywhere in
-- this system, so there is nothing to provision beyond the membership row.
-- -----------------------------------------------------------------------------

create table if not exists organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  email           text not null,
  role            app_role not null default 'salesperson',
  invited_by      uuid references auth.users (id) on delete set null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_invites_email_shape check (position('@' in email) > 1)
);

-- One open invite per address per org. Accepted rows are kept as an audit trail
-- and do not block re-inviting someone who was removed.
create unique index if not exists organization_invites_open_email_idx
  on organization_invites (organization_id, lower(email))
  where accepted_at is null;

create index if not exists organization_invites_email_idx
  on organization_invites (lower(email)) where accepted_at is null;

drop trigger if exists touch_organization_invites on organization_invites;
create trigger touch_organization_invites before update on organization_invites
  for each row execute function app.touch_updated_at();

alter table organization_invites enable row level security;

-- Only admins and managers of the org can see or manage its invites. The
-- trigger below is SECURITY DEFINER, so provisioning does not depend on these.
drop policy if exists organization_invites_read on organization_invites;
create policy organization_invites_read on organization_invites
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists organization_invites_write on organization_invites;
create policy organization_invites_write on organization_invites
  for all using (app.has_org_role(organization_id, array['admin']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin']::app_role[]));

-- -----------------------------------------------------------------------------
-- Extend the existing signup trigger. It already creates the profile row; now
-- it also redeems any open invite for the new user's address.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  inv record;
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;

  if new.email is null then
    return new;
  end if;

  for inv in
    select id, organization_id, role
      from organization_invites
     where lower(email) = lower(new.email)
       and accepted_at is null
     order by created_at
  loop
    insert into organization_members (organization_id, user_id, role)
    values (inv.organization_id, new.id, inv.role)
    on conflict (organization_id, user_id)
      do update set role = excluded.role, is_active = true, updated_at = now();

    update organization_invites
       set accepted_at = now(), accepted_by = new.id
     where id = inv.id;

    update profiles
       set default_org_id = coalesce(default_org_id, inv.organization_id)
     where id = new.id;
  end loop;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Redeem outstanding invites for users who already exist. Signups that happened
-- before this migration never saw the loop above; this makes the migration
-- idempotent with respect to ordering.
-- -----------------------------------------------------------------------------
create or replace function app.redeem_pending_invites()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  redeemed integer := 0;
  rec record;
begin
  for rec in
    select i.id as invite_id, i.organization_id, i.role, u.id as user_id
      from organization_invites i
      join auth.users u on lower(u.email) = lower(i.email)
     where i.accepted_at is null
  loop
    insert into organization_members (organization_id, user_id, role)
    values (rec.organization_id, rec.user_id, rec.role)
    on conflict (organization_id, user_id)
      do update set role = excluded.role, is_active = true, updated_at = now();

    update organization_invites
       set accepted_at = now(), accepted_by = rec.user_id
     where id = rec.invite_id;

    update profiles
       set default_org_id = coalesce(default_org_id, rec.organization_id)
     where id = rec.user_id;

    redeemed := redeemed + 1;
  end loop;

  return redeemed;
end;
$$;

revoke all on function app.redeem_pending_invites() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Seed: the owner is admin of Delta Ridge Roofing on first sign-in.
-- -----------------------------------------------------------------------------
insert into organization_invites (organization_id, email, role)
select 'd17a0000-0000-4000-8000-000000000001'::uuid, 'nedpearson@gmail.com', 'admin'::app_role
where not exists (
  select 1 from organization_invites
   where organization_id = 'd17a0000-0000-4000-8000-000000000001'::uuid
     and lower(email) = 'nedpearson@gmail.com'
);

select app.redeem_pending_invites();
