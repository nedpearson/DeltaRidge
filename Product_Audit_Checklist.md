# Delta Ridge Master Implementation Checklist

This checklist tracks the implementation of the complete product architecture, UX, lead intelligence, and sales management master audit.

## 1. First Phase — Complete Product Audit
- [x] Document every route and page
- [x] Document every major component
- [x] Document every manager & rep function
- [x] Document every database-backed & offline workflow
- [x] Identify duplicate capabilities & dead-end buttons
- [x] Identify obscure navigation & excessive scrolling
- [x] Identify disconnected data screens

## 2. Navigation & Information Architecture
- [x] Restructure Rep Navigation: TODAY · LEADS · MAP · JOBS · MORE
- [x] Restructure Manager Navigation into 5 Workspaces:
  - [x] COMMAND CENTER (Today, live field, exceptions, goals, alerts)
  - [x] LEADS & TERRITORY (Opportunity generator, campaigns, territory, map)
  - [x] TEAM & ROUTES (Team, routes, playback, performance, coaching)
  - [x] SALES & REVENUE (Pipeline, appointments, inspections, proposals)
  - [x] OPERATIONS (Roofr, contacts, integration health, settings, audit log)

## 3. Rep "Today" Cockpit
- [ ] Build Rep Home Experience
  - [ ] Good Morning Header
  - [ ] Daily Progress / Metrics
  - [ ] Next Best Action (Explainable recommendation)
  - [ ] Active Route Status
  - [ ] Overdue follow-ups & Missing inspections

## 4. Manager Command Center
- [ ] Build Manager Command Center
  - [ ] Team Now (Status, route, last activity, sync state)
  - [ ] Live Field View (Intentional route activity, last GPS, path)
  - [ ] Exception Center (Overdue follow-ups, incomplete inspections, stalled syncs)

## 5. Lead Intelligence & Universal Lead 360
- [ ] Search Around My Location (Device GPS, Opportunity/Intent/Contactability)
- [ ] Best Opportunities Near Me (Ranked by selling priority)
- [ ] Why This House / Show Proof (Evidence-backed claims)
- [ ] Universal Lead 360 (Canonical record: Overview, Contact, Property, Roof, Storms, Field, etc.)
- [ ] Universal Timeline (Chronological events, offline vs server-backed)

## 6. Territory, Campaigns & Routing
- [ ] Manager Lead Assignment (Decision-support system)
- [ ] Territory Intelligence (Opportunities vs Coverage)
- [ ] Campaign Management (Geographic area, storm, progress, gross profit)
- [ ] Routing (Logical stop ordering, current location)

## 7. Scheduling, Inspections & Proposals
- [ ] Appointments & Calendar (Unified scheduling, Appointment Prep Brief)
- [ ] Inspection Experience (Guided evidence, fast photo capture, missing item jumps)
- [ ] Estimating & Proposals (Connected workflow from inspection, Good/Better/Best options)
- [ ] Communication Hub (Calls, SMS, Email unified in record)

## 8. Automation & Performance
- [ ] Automation Engine (Configurable workflow rules)
- [ ] Next Best Action Engine (Explainable recommendations)
- [ ] Manager Performance (Funnel metrics, lead quality context)
- [ ] Rep Coaching (Drill-down to Lead 360)
- [ ] Manager Daily Brief (Factual morning report)
- [ ] Lead Economics (Gross profit per generated opportunity, source attribution)

## 9. Global Systems & UI/UX
- [ ] Universal Search (Global Cmd/Ctrl + K search)
- [ ] Breadcrumbs / Return State (Context preservation)
- [ ] Responsive Desktop & Mobile Workspaces
- [ ] Visual System Refinement (Midnight/navy, Cobalt, Cyan, Muted gold, Amber, Green, Red)
- [ ] Empty / Error / Loading States (Clear, actionable states)
- [ ] Integration Health (EagleView, Roofr, Contacts, Supabase)
- [ ] Audit Log (Human-readable history)
- [ ] Performance & Offline Resilience (Offline-first workflows, durable sync outbox)
- [ ] Accessibility (WCAG contrast, focus, labels)

## 10. QA & Production Readiness
- [ ] End-to-End User Journey Tests (Rep Golden Flow, Manager Golden Flow)
- [ ] Typecheck & Lint (`npm run typecheck`, `npm run lint`)
- [ ] Unit & Playwright Tests (`npm test`)
- [ ] Device QA (Mobile, Tablet, Desktop)
