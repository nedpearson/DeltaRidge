-- =============================================================================
-- 0038  Lead outcome attribution view
-- =============================================================================
-- One read model for the question the lead engine ultimately has to answer:
-- what happened to the opportunities we generated?
--
-- Revenue remains conservative:
--   * a signed Roofr proposal is contract value;
--   * a Delta Ridge lead marked sold may use its latest immutable estimate;
--   * an unsold proposal is never counted as revenue.
-- Gross profit here is an ESTIMATE from contract value less the latest estimate
-- job cost. It is not cash collected and it is not job-cost actuals.
-- =============================================================================

create or replace view lead_outcome_attribution
with (security_invoker = true)
as
select
  l.organization_id,
  l.id as lead_id,
  l.client_id as lead_client_id,
  l.property_id,
  l.customer_id,
  l.assigned_to,
  l.status,
  l.lead_source_id,
  l.campaign_id,
  l.opportunity_score,
  l.intent_score,
  l.contactability_score,
  l.intelligence_level,
  l.intelligence_version,
  l.created_at,
  l.first_contacted_at,
  l.last_activity_at,
  l.next_action_at,

  rl.roofr_job_id,
  rl.workflow_stage as roofr_workflow_stage,
  rl.proposal_sent_at,
  rl.proposal_viewed_at,
  rl.proposal_signed_at,
  rl.proposal_lost_at,
  case
    when rl.proposal_signed_at is not null then rl.proposal_total_cents
    else null
  end as roofr_signed_total_cents,

  ev.version_number as latest_estimate_version,
  ev.sell_price_cents as latest_estimate_sell_price_cents,
  ev.job_cost_cents as latest_estimate_job_cost_cents,

  case
    when rl.proposal_signed_at is not null and rl.proposal_total_cents is not null
      then rl.proposal_total_cents
    when l.status = 'sold' and ev.sell_price_cents is not null
      then ev.sell_price_cents
    else null
  end as attributed_contract_value_cents,

  case
    when rl.proposal_signed_at is not null and rl.proposal_total_cents is not null
      then 'roofr_signed_proposal'
    when l.status = 'sold' and ev.sell_price_cents is not null
      then 'delta_ridge_sold_estimate'
    else null
  end as value_basis,

  case
    when ev.job_cost_cents is null then null
    when rl.proposal_signed_at is not null and rl.proposal_total_cents is not null
      then greatest(0, rl.proposal_total_cents - ev.job_cost_cents)
    when l.status = 'sold' and ev.sell_price_cents is not null
      then greatest(0, ev.sell_price_cents - ev.job_cost_cents)
    else null
  end as estimated_gross_profit_cents,

  case
    when rl.proposal_signed_at is not null or l.status = 'sold' then 'won'
    when rl.proposal_lost_at is not null or l.status in ('lost', 'not_interested') then 'lost'
    when l.status in ('proposal_pending') then 'proposal'
    when l.status in ('inspected') then 'inspected'
    when l.status in ('appointment') then 'appointment'
    when l.status in ('inspection_requested', 'interested') then 'engaged'
    when l.first_contacted_at is not null then 'contacted'
    else 'target'
  end as funnel_stage

from leads l
left join roofr_links rl
  on rl.lead_id = l.id
left join lateral (
  select
    v.version_number,
    v.sell_price_cents,
    v.job_cost_cents
  from estimates e
  join estimate_versions v on v.estimate_id = e.id
  where e.lead_id = l.id
    and e.deleted_at is null
  order by v.version_number desc, v.created_at desc
  limit 1
) ev on true
where l.deleted_at is null;

grant select on lead_outcome_attribution to authenticated;

comment on view lead_outcome_attribution is
  'Outcome attribution by lead. attributed_contract_value_cents counts only a signed Roofr proposal or a Delta Ridge lead explicitly marked sold. estimated_gross_profit_cents is contract value minus latest estimate job cost, not cash collected.';
