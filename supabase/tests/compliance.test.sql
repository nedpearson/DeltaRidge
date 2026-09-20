-- =============================================================================
-- Compliance rules: constraint and history assertions
-- =============================================================================
-- The claims under test:
--   1. A rule with no source must declare itself REQUIRES VERIFICATION.
--   2. A half-filled source is rejected - a citation with no verification date
--      is worse than no citation, because it looks checked.
--   3. A source URL must be https.
--   4. An effect must carry a discriminating "kind".
--   5. Every change to a rule is recorded in history.
-- =============================================================================

do $$
begin
  -- 1
  begin
    insert into compliance_rules (id, category, state, summary, effect, effective_from, notes)
    values ('t-unsourced', 'permit', 'LA', 'EBR fee',
            '{"kind":"permit_required"}'::jsonb, '2025-08-01', 'we think it is $75');
    raise exception 'FAIL 1: an unsourced rule was accepted without declaring itself';
  exception when check_violation then null;
  end;

  -- 2
  begin
    insert into compliance_rules (id, category, state, summary, effect, effective_from,
      source_tier, source_citation)
    values ('t-halfsource', 'licensing', 'LA', 'x',
            '{"kind":"require_license"}'::jsonb, '2026-01-01', 'statute', 'La. R.S. 37:2156.4');
    raise exception 'FAIL 2: a rule with a citation but no verification date was accepted';
  exception when check_violation then null;
  end;

  -- 3
  begin
    insert into compliance_rules (id, category, state, summary, effect, effective_from,
      source_tier, source_citation, source_url, source_verified_at, source_verified_by)
    values ('t-http', 'licensing', 'LA', 'x', '{"kind":"require_license"}'::jsonb,
            '2026-01-01', 'statute', 'c', 'http://legis.la.gov/x', '2026-09-19', 'ned');
    raise exception 'FAIL 3: a non-https source url was accepted';
  exception when check_violation then null;
  end;

  -- 4
  begin
    insert into compliance_rules (id, category, state, summary, effect, effective_from,
      source_tier, source_citation, source_url, source_verified_at, source_verified_by)
    values ('t-nokind', 'licensing', 'LA', 'x', '{"threshold":750000}'::jsonb,
            '2026-01-01', 'statute', 'c', 'https://legis.la.gov/x', '2026-09-19', 'ned');
    raise exception 'FAIL 4: an effect with no kind was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- The two shapes that must be accepted.
insert into compliance_rules (id, category, state, applies_to, summary, effect,
  effective_from, notes)
values ('t-ok-unsourced', 'permit', 'LA', '{"East Baton Rouge"}', 'EBR reroof permit',
  '{"kind":"permit_required","permitType":"EBR reroof permit","feeCents":null}'::jsonb,
  '2025-08-01', 'REQUIRES VERIFICATION. Read the EBR permit office page first.');

insert into compliance_rules (id, category, state, summary, effect, effective_from,
  source_tier, source_citation, source_url, source_verified_at, source_verified_by,
  review_interval_months)
values ('t-ok-sourced', 'licensing', 'LA',
  'Residential roofing of $7,500 or more requires a licence.',
  '{"kind":"require_license","minimumProjectValueCents":750000}'::jsonb, '2026-01-01',
  'statute', 'La. R.S. 37:2156.4', 'https://legis.la.gov/Legis/law.aspx?d=1431142',
  '2026-09-19', 'claude+ned', 6);

-- 5
do $$
declare n integer;
begin
  update compliance_rules set review_interval_months = 3 where id = 't-ok-sourced';

  select count(*) into n from compliance_rule_history where rule_id = 't-ok-sourced';
  if n <> 2 then
    raise exception 'FAIL 5: expected an insert and an update in history, saw %', n;
  end if;

  select count(*) into n
    from compliance_rule_history
   where rule_id = 't-ok-sourced'
     and operation = 'update'
     and (previous_state ->> 'review_interval_months') = '6'
     and (new_state ->> 'review_interval_months') = '3';
  if n <> 1 then
    raise exception 'FAIL 5b: history did not record the before and after values';
  end if;
end;
$$;

delete from compliance_rules where id like 't-%';

\echo 'compliance.test.sql: all assertions passed'
