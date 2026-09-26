-- =============================================================================
-- Lead economics attribution for manager reporting.
--
-- This view intentionally remains security_invoker=true because it exposes
-- job cost and gross profit. The estimate_versions base table already restricts
-- those fields to managers/admins through RLS. Salespeople must continue to use
-- the cost-free estimate_versions_sales view.
-- =============================================================================

create or replace view manager_lead_economics
with (security_invoker = true)
as
with latest_version as (
  select distinct on (v.estimate_id)
    v.organization_id,
    v.estimate_id,
    v.version_number,
    v.sell_price_cents,
    v.job_cost_cents,
    v.created_at as version_created_at
  from estimate_versions v
  order by v.estimate_id, v.version_number desc
)
select
  e.organization_id,
  l.id as lead_id,
  l.client_id as lead_client_id,
  l.status::text as lead_status,
  l.assigned_to,
  l.opportunity_score,
  l.lead_source_id,
  ls.name as lead_source_name,
  ls.category as lead_source_category,
  l.campaign_id,
  c.name as campaign_name,
  p.address_line1,
  p.subdivision,
  e.id as estimate_id,
  e.client_id as estimate_client_id,
  lv.version_number,
  lv.sell_price_cents,
  lv.job_cost_cents,
  case
    when lv.sell_price_cents is null then null
    else lv.sell_price_cents - lv.job_cost_cents
  end as gross_profit_cents,
  case
    when lv.sell_price_cents is null or lv.sell_price_cents = 0 then null
    else round(
      ((lv.sell_price_cents - lv.job_cost_cents)::numeric / lv.sell_price_cents::numeric) * 10000
    )::integer
  end as gross_margin_bps,
  lv.version_created_at,
  rl.proposal_signed_at,
  rl.proposal_total_cents as roofr_proposal_total_cents,
  (l.status = 'sold' or rl.proposal_signed_at is not null) as closed_won
from estimates e
join latest_version lv
  on lv.estimate_id = e.id
 and lv.organization_id = e.organization_id
join leads l
  on l.id = e.lead_id
 and l.organization_id = e.organization_id
left join properties p
  on p.id = l.property_id
 and p.organization_id = l.organization_id
left join lead_sources ls
  on ls.id = l.lead_source_id
 and ls.organization_id = l.organization_id
left join campaigns c
  on c.id = l.campaign_id
 and c.organization_id = l.organization_id
left join roofr_links rl
  on rl.lead_id = l.id
 and rl.organization_id = l.organization_id
where e.deleted_at is null
  and l.deleted_at is null;

comment on view manager_lead_economics is
  'Manager/admin-only lead-to-estimate economics. Uses latest immutable estimate version and attributes selling price, cost and gross profit back to the originating lead/source/campaign.';

grant select on manager_lead_economics to authenticated;
