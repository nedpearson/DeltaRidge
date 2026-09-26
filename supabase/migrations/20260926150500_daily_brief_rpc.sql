create or replace function get_manager_daily_brief_metrics(org_id uuid, target_date date)
returns jsonb
language sql
security definer
set search_path = public
as $func
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
        and type = 'door_knock'
        and date_trunc('day', created_at at time zone 'America/Chicago')::date = target_date
    ),
    'conversations', (
      select count(*) 
      from activities 
      where organization_id = org_id 
        and type = 'conversation'
        and date_trunc('day', created_at at time zone 'America/Chicago')::date = target_date
    ),
    'contract_value', (
      select coalesce(sum(estimated_value), 0)
      from leads 
      where organization_id = org_id 
        and status = 'won'
        and date_trunc('day', updated_at at time zone 'America/Chicago')::date = target_date
    ),
    'overdue_followups', (
      select count(*)
      from leads
      where organization_id = org_id
        and status = 'follow_up'
        and updated_at < now() - interval '2 days'
    )
  );
$func;
