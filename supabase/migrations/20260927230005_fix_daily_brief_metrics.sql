create or replace function get_manager_daily_brief_metrics(org_id uuid, target_date date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'doors_assigned', (
      select count(*) 
      from lead_assignments 
      where organization_id = org_id 
        and date_trunc('day', assigned_at at time zone 'America/Chicago')::date = target_date
    ),
    'doors_knocked', (
      select count(*) 
      from activities 
      where organization_id = org_id 
        and activity_type = 'door_knock'
        and date_trunc('day', created_at at time zone 'America/Chicago')::date = target_date
    ),
    'conversations', (
      select count(*) 
      from activities 
      where organization_id = org_id 
        and activity_type = 'conversation'
        and date_trunc('day', created_at at time zone 'America/Chicago')::date = target_date
    ),
    'contract_value', (
      select coalesce(sum(ev.sell_price_cents), 0) / 100
      from leads l
      join estimates e on e.lead_id = l.id
      join estimate_versions ev on ev.estimate_id = e.id
      where l.organization_id = org_id 
        and l.status = 'sold'
        and date_trunc('day', l.updated_at at time zone 'America/Chicago')::date = target_date
        and ev.version_number = (
          select max(version_number) 
          from estimate_versions ev2 
          where ev2.estimate_id = e.id
        )
    ),
    'overdue_followups', (
      select count(*)
      from leads
      where organization_id = org_id
        and status in ('attempted', 'interested', 'proposal_pending')
        and updated_at < now() - interval '2 days'
    )
  );
$$;
