-- -----------------------------------------------------------------------------
-- Assigning a door now actually moves it.
--
-- Two columns described ownership and nothing kept them honest:
--
--   * `leads.assigned_to` is set by `pushLead` to whoever's device pushed the
--     lead. Every one of the first 68 leads therefore belonged to Ned, because
--     his phone built the list.
--   * `lead_assignments` is written by the manager screen and never touched
--     `leads.assigned_to`.
--
-- So a manager could hand Chad a door, see the assignment row appear, and have
-- `leads.assigned_to` still say Ned. Anything reading the column disagreed with
-- anything reading the table — and `useRepToday` reads the table while other
-- screens read the column, so the same door could be in both reps' lists or
-- neither.
--
-- Done as a trigger rather than a second client write, for the reason
-- `lead_assignment_history` already is: a client that forgets cannot create a
-- gap. `leads` has two AFTER UPDATE triggers, both guarded on status becoming
-- 'sold', so moving only `assigned_to` does not fire them.
-- -----------------------------------------------------------------------------

create or replace function app.sync_lead_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'INSERT' then
    update leads
       set assigned_to = new.assigned_to
     where id = new.lead_id
       and assigned_to is distinct from new.assigned_to;
    return new;
  end if;

  -- Closing an assignment hands the door back to nobody. Guarded on the rep
  -- still holding it: if the lead has already moved on to someone else, a late
  -- close-out of the old assignment must not snatch it back.
  if new.unassigned_at is not null and old.unassigned_at is null then
    update leads
       set assigned_to = null
     where id = new.lead_id
       and assigned_to is not distinct from old.assigned_to;
  end if;

  return new;
end;
$fn$;

drop trigger if exists lead_assignments_sync_assignee on lead_assignments;
create trigger lead_assignments_sync_assignee
  after insert or update on lead_assignments
  for each row execute function app.sync_lead_assignee();
