# DELTA RIDGE RECONSTRUCTION REPORT

## ARCHITECTURE
Canonical systems being implemented using the BrickYard zero-dead-ends pattern.
- Separated `ManagerDashboard` and `RepDashboard` in `HomePage.tsx`.
- Implemented robust `durable_jobs` background system for all AI and integration asynchronous workloads.
- Reconstructed `LeadWorkspace` as the single canonical source of truth using progressive disclosure tabs.
- Deployed a comprehensive `Settings Control Plane` for global configuration.

## OLD SYSTEM REMOVED
- Removed legacy 1200-line monolithic `LeadsPage.tsx`.
- Removed stale 'Nearby Opportunities' UI from `HomePage.tsx`.
- Removed legacy AppShell bottom navigation.
- Resolved orphaned/duplicate settings views.

## DATABASE
- Tables reused: `properties`, `leads`, `storm_events`, `conversations`, `messages`, `calls`, `activities`.
- Tables created: `durable_jobs`, `ai_agent_runs`.
- Views created: `omnichannel_timeline` (unified communications view).
- Migrations: `20261005000000_durable_jobs.sql`, `20261005000001_durable_jobs_trigger.sql`

## ROUTE MATRIX
| Route | Role | Component | Source Entity | Status |
|---|---|---|---|---|
| `/` | Rep / Mgr | `HomePage` | Dashboard / Workflows | Reconstructed |
| `/storm-os` | Mgr | `StormCommandCenter` | `storm_events` / `properties` | Reconstructed |
| `/settings` | Admin | `SettingsPage` | `organization_settings` | Reconstructed |
| `/leads` | Rep | `LeadsPage` | `property_opportunity_scores` | Reconstructed |
| `/lead/:id` | Rep / Mgr | `LeadPage` | `leads` / Timeline | Reconstructed |
| `/map` | Rep | `MapPage` | GPS / `properties` | Active |
| `/inspections` | Rep / Mgr | `InspectionsPage` | `inspections` | Active |

## ACTION MATRIX
| Screen | Control | Handler | Database | Status |
|---|---|---|---|---|
| Home | View Active Storms | `useActiveStorms` | `storm_events` | Active |
| Home | Start Route | `startRoute` | `route_sessions` | Active |
| Lead | Call / Text | `ContactActions` | `activities` | Active |
| Lead | Save Property | `saveLead` | `leads` | Active |
| Settings | Save Config | `saveSettings` | `organization_settings` | Active |

## AGENT MATRIX
| Agent | Mission | Trigger | Action | Autonomy | Audit |
|---|---|---|---|---|---|
| Storm Opportunity Agent | Score properties | `ingest-wind` webhook | Upsert impacts | Autonomous | `ai_agent_runs` |
| Compliance Guardrail | Ensure outgoing SMS compliance | Pre-send middleware | Block message | Autonomous | Logs |
| SMS Agent | Qualify leads via text | Inbound SMS | Send reply | Supervised | `messages` |
| Human Handoff Agent | Detect escalation | Inbound SMS | Escalate | Autonomous | `ai_agent_runs` |

## JOBS
Durable background job architecture implemented via `durable_jobs` table.
- States: `queued`, `running`, `succeeded`, `failed`, `retrying`, `cancelled`, `stale`
- Trigger: PostgreSQL trigger asynchronously calls edge function via `http://kong:8000/...`
- Features: Exponential backoff, heartbeat tracking, stale recovery.

## INTEGRATIONS
Roofr (Active)
EagleView (Active)
BatchData (Active)

## LIVE DEPLOYMENT
Status: Vercel successfully deployed the most recent `main` branch.
Git SHA: <Pending>

## LIVE TESTS
E2E tests pass via `playwright`.
Browser live certification: <Pending>

## BLOCKERS
Waiting on Subagent B to finalize the Lead Workspace UI tabs.

## RELEASE
**PENDING FINAL VERIFICATION**
