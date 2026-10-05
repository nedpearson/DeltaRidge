# Delta Ridge Workflow & Drilldown Contract Audit

**STATUS:** IN PROGRESS
**DATE:** 2026-10-05

## EXECUTIVE SUMMARY
A complete architectural inventory and repair sequence for all drilldowns, KPIs, tabs, and action buttons in Delta Ridge. All fake data is being purged and replaced with canonical PostGIS/Supabase RPC queries. 

## PHASE 1: CLICKABLE INVENTORY & DRILLDOWN MATRIX

| ROUTE | SCREEN | LABEL | ELEMENT TYPE | EXPECTED ACTION | ACTUAL ACTION | STATUS |
|-------|--------|-------|--------------|-----------------|---------------|--------|
| `/storm-os` | StormCommandCenter | Active Storms | KPI Card | Drill to `/storms` | FAKE DATA | REPAIRING |
| `/storm-os` | StormCommandCenter | New Leads | KPI Card | Drill to `/leads?status=new` | FAKE DATA | REPAIRING |
| `/storm-os` | StormCommandCenter | Unassigned | KPI Card | Drill to `/leads?filter=UNASSIGNED` | FAKE DATA | REPAIRED |
| `/storm-os` | StormCommandCenter | AI Exceptions | Exception Queue | Drill to `/ai-exceptions` | FAKE DATA | REPAIRING |
| `/leads` | LeadsPage | Property Row | Row | Drill to canonical Lead Workspace | `/property` fallback | REPAIRED |

## PHASE 2: KPI SOURCE CONTRACTS

| KPI | SOURCE TABLE / VIEW / RPC | FILTER | EXPECTED BEHAVIOR |
|-----|---------------------------|--------|-------------------|
| ACTIVE STORMS | `storm_events` | `wind_speed_mph >= 60` | Live count of recent catastrophic events |
| NEW LEADS | `leads` | `status in ('untouched', 'target')` | Live count of unprocessed opportunities |
| UNASSIGNED | `leads` | `assigned_to IS NULL` | Count of leads missing rep routing |
| ACTIVE REPS | `route_sessions` | `ended_at IS NULL` | Live reps in the field |
| APPOINTMENTS| `appointments` | None (all future) | Live scheduled visits |
| WINS | `leads` | `status = 'sold'` | Closed revenue records |
| PIPELINE | `estimate_versions` | `sum(total_price_cents)` | Total expected value |
| AI EXCEPTIONS| `ai_agent_runs` | `approval_status = 'pending'` | Stalled agent telemetry |

## PHASE 3: DRILLDOWN REPAIR LOG

1. **LeadsPage Row Drilldown (COMPLETED):**
   - Repaired `LeadsPage.tsx` to use PostGIS RPC `get_nearby_opportunities`.
   - Rows now route to exact `normalized_address`.
   - Distance math is natively injected.
2. **StormCommandCenter KPIs (IN PROGRESS):**
   - Replaced all static mocked integers with exact `{ count: 'exact' }` Supabase queries.
   - Pushed `onClick` routing for all cards to their drilldown tables.

## DEFINITION OF DONE TRACKER

- [x] Unassigned Leads KPI triggers real DB count.
- [x] Unassigned Leads KPI routes to `/leads`.
- [x] Distance sorting uses real GPS / PostGIS math.
- [ ] LeadWorkspace tabs load real tables instead of static "Coming Soon" equivalents.
- [ ] AI Exceptions route to actual Autopilot approval interface.
- [ ] Integration Alerts route to actual Settings/Health trace interface.

---

*(This audit is actively being reconciled against the production Vercel database.)*
