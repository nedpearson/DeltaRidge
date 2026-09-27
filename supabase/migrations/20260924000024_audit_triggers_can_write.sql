-- =============================================================================
-- 0024  The append-only logs could not actually be written to
-- =============================================================================
-- Found by using the app: saving a manager's grade returned 403.
--
-- `rep_grade_events` and `lead_assignment_history` are deliberately writable by
-- nobody — they have RLS enabled and no INSERT policy at all, so the only thing
-- that may add to them is the trigger. That was the right design and it was
-- half-implemented: the trigger functions were SECURITY INVOKER, so they ran as
-- the signed-in user and were refused by the very policy gap that was supposed
-- to protect them. The log was unwritable by everyone, including its own
-- trigger, which then failed the whole insert it was attached to.
--
-- The consequence is worth stating plainly: a manager could not record a grade,
-- and — latent since 0017 — assigning a lead would have failed the same way the
-- first time anybody tried it from the UI.
--
-- SECURITY DEFINER is the fix and is safe here for specific reasons:
--   - Neither function takes input. It writes only what the trigger row already
--     contains, so there is no argument to smuggle anything through.
--   - search_path is pinned, so no schema can be shadowed to redirect a write.
--   - Both are trigger functions. A trigger function cannot be called directly
--     over the API, so elevating it does not widen the surface a client can
--     reach.
--   - The tables stay unwritable by clients: no INSERT policy is added.
--
-- Rollback: recreate both functions without `security definer`. Doing so
-- restores the bug, so it is a rollback of last resort.
-- =============================================================================

create or replace function app.log_rep_grade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  what text;
begin
  if tg_op = 'INSERT' then
    what := case when new.manager_letter is not null then 'graded' else 'computed' end;
  elsif new.manager_letter is distinct from old.manager_letter then
    what := case
              when new.manager_letter is null then 'cleared'
              when old.manager_letter is null then 'graded'
              else 'regraded'
            end;
  else
    return new;
  end if;

  insert into rep_grade_events
    (organization_id, grade_id, rep_id, action, actor, ai_letter, manager_letter, reason)
  values
    (new.organization_id, new.id, new.rep_id, what,
     coalesce(new.graded_by, auth.uid()), new.ai_letter, new.manager_letter,
     new.manager_override_reason);
  return new;
end $$;

create or replace function app.log_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'assigned', new.assigned_to,
       new.assigned_by, new.lead_score_at_assignment, new.reason, new.assigned_at);
  elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'unassigned', new.assigned_to,
       auth.uid(), new.lead_score_at_assignment, new.reason, new.unassigned_at);
  end if;
  return new;
end $$;

-- Neither is callable over the API; revoking anyway so the intent is explicit.
revoke all on function app.log_rep_grade() from public, anon, authenticated;
revoke all on function app.log_lead_assignment() from public, anon, authenticated;

comment on function app.log_rep_grade() is
  'Writes the grading audit row. SECURITY DEFINER because the log has no INSERT '
  'policy by design — the trigger is meant to be its only writer, and as an '
  'invoker function it was refused by that same gap.';

comment on function app.log_lead_assignment() is
  'Writes the assignment audit row. SECURITY DEFINER for the same reason as '
  'app.log_rep_grade.';
