-- Recover organization membership for auth users who existed before their invite.
-- This RPC is intentionally self-service only: it can redeem invites matching
-- the current authenticated user's own email and cannot choose an org or role.

create or replace function public.redeem_my_pending_invites()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  rec record;
  redeemed integer := 0;
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;

  select email into caller_email
    from auth.users
   where id = caller_id;

  if caller_email is null then
    return 0;
  end if;

  for rec in
    select i.id as invite_id, i.organization_id, i.role
      from organization_invites i
     where lower(i.email) = lower(caller_email)
       and i.accepted_at is null
     order by i.created_at
  loop
    insert into organization_members (organization_id, user_id, role)
    values (rec.organization_id, caller_id, rec.role)
    on conflict (organization_id, user_id)
      do update set role = excluded.role, is_active = true, updated_at = now();

    update organization_invites
       set accepted_at = now(), accepted_by = caller_id
     where id = rec.invite_id
       and accepted_at is null;

    update profiles
       set default_org_id = coalesce(default_org_id, rec.organization_id)
     where id = caller_id;

    redeemed := redeemed + 1;
  end loop;

  return redeemed;
end;
$$;

revoke all on function public.redeem_my_pending_invites() from public, anon;
grant execute on function public.redeem_my_pending_invites() to authenticated;

comment on function public.redeem_my_pending_invites() is
  'Redeems open organization invites that match only the current authenticated user email.';
