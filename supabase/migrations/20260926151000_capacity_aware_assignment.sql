-- =============================================================================
-- Capacity-Aware Lead Assignment
-- =============================================================================
-- Prevents managers from blindly assigning leads to reps who are already over
-- capacity (more than 15 open assignments), enforcing the "Capacity-Aware" 
-- rule at the database level.
-- =============================================================================

create or replace function check_rep_capacity()
returns trigger
language plpgsql
security definer
as $$
declare
  open_assignments int;
begin
  -- Only check on new assignments (where unassigned_at is null)
  if NEW.unassigned_at is not null then
    return NEW;
  end if;

  select count(*)
  into open_assignments
  from lead_assignments
  where assigned_to = NEW.assigned_to
    and unassigned_at is null;

  if open_assignments >= 15 then
    raise exception 'Capacity Exceeded: This rep already has 15 or more open assignments. Please release some doors before assigning new ones.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_rep_capacity on lead_assignments;
create trigger enforce_rep_capacity
  before insert or update on lead_assignments
  for each row
  execute function check_rep_capacity();

