# Delta Ridge Sellable-Business Roadmap

## Objective

Turn Delta Ridge from a storm-driven roofing operator into a technology-enabled, recurring-revenue, acquisition-ready business with:

- a reliable field-to-server operating system;
- evidence-driven lead generation;
- measurable sales productivity;
- a recurring RoofCare membership base;
- automated customer lifecycle marketing;
- clean financial/KPI reporting;
- documented SOPs and management depth;
- clear software/IP ownership;
- buyer-ready operating records.

This roadmap is ordered by dependency and enterprise-value impact. Do not skip a phase because later features look more exciting.

---

## Phase 0 — Production truth and reliability

**Goal:** prove the core system never loses field work and the production data model is authoritative.

### Deliverables

- Apply all pending database migrations in production.
- Prove end-to-end sync for:
  - leads;
  - activities;
  - inspections;
  - photos;
  - voice notes;
  - route sessions and GPS chunks;
  - lead status changes.
- Durable outbox with retry, auth recovery, idempotency and dead-letter handling.
- Second-client verification: data created on a rep device must load correctly on a manager device.
- Integration health dashboard with queue depth, last success and failures.
- Golden Lead smoke test executed on every production release.
- Backup/restore test and documented rollback.

### Exit criteria

No field record exists only on a rep device after connectivity returns. Duplicate retries do not create duplicate logical records. Failed syncs are visible and actionable.

---

## Phase 1 — Canonical Lead 360 and data provenance

**Goal:** one customer/property/lead record becomes the operating source of truth.

### Deliverables

- Stable IDs and external-ID mappings for Delta Ridge, Roofr and providers.
- Lead 360 drill-down for:
  - property;
  - owner/contact;
  - roof;
  - storm;
  - imagery;
  - permits;
  - field activity;
  - inspections;
  - voice notes;
  - proposals;
  - claim documentation;
  - follow-up;
  - Roofr linkage.
- Universal activity timeline.
- Source/date/confidence attached to every important fact.
- Data-health panel and conflict center.
- Universal search across address, owner, phone, email, claim number, route, storm, voice transcript and documents.
- Preserve filters, map extent and scroll position when drilling in/out.

### Exit criteria

Any KPI or AI conclusion can be drilled down to the underlying property, event, document, image, route or activity that produced it.

---

## Phase 2 — Lead intelligence and field productivity

**Goal:** reduce dependence on random canvassing and prove better unit economics.

### Deliverables

- Separate storm-evidence tiers:
  - multi-source strong evidence;
  - official-report support;
  - radar/MESH only;
  - possible exposure;
  - no material evidence.
- MRMS/MESH server-side ingest and health monitoring.
- Property/owner enrichment.
- EagleView imagery/measurement integration where licensed.
- Transparent lead-opportunity scoring after sufficient outcome data exists.
- Rep route recording, GPS-verified knocks and route replay.
- Rep scorecards normalized for lead quality.
- Capacity-aware lead assignment.
- Revenue Leakage dashboard.
- 60–90 day controlled test comparing targeted intelligence leads with traditional canvassing.

### Primary KPIs

- productive rep hours;
- contacts per rep hour;
- appointments per rep hour;
- contracts per rep hour;
- gross profit per rep hour;
- lead-to-contract rate;
- CAC by source;
- gross profit by source.

### Exit criteria

Delta Ridge can quantify whether targeted intelligence leads outperform conventional canvassing and by how much.

---

## Phase 3 — RoofCare recurring revenue

**Goal:** convert the installed customer base into predictable recurring revenue and customer lifetime value.

### Deliverables

- Final RoofCare brand and three membership tiers.
- Exact pricing, included services, exclusions, renewal rules and cancellation terms.
- Annual pre-storm roof documentation workflow.
- Annual inspection and roof-history report.
- Priority post-storm response.
- Member portal and renewal engine.
- Offer RoofCare inside every new proposal and completion workflow.
- Historical-customer conversion campaign by roof-age cohort.
- Membership dashboard.
- Referral program tied to members.
- Member storm-response workflow.

### Required economics

Track:

- beginning members;
- new members;
- churn;
- ending members;
- ARR;
- service cost;
- contribution margin;
- repair revenue;
- referral revenue;
- replacement revenue;
- gross retention;
- renewal rate;
- member LTV.

### Exit criteria

Membership contribution margin and retention are proven with real cohorts, not assumed.

---

## Phase 4 — Customer lifecycle and automated demand generation

**Goal:** turn the customer database into a compounding lead source.

### Deliverables

- Automated review requests and responses.
- Referral tracking.
- 90-day and annual social-content engine.
- Storm-triggered local content.
- Completed-job content automation.
- Retargeting audiences by lifecycle stage.
- Local SEO pages by geography and storm event.
- Customer portal.
- Replacement-window forecasting for installed roofs.
- Neighborhood campaign engine around completed jobs.
- Member and lapsed-member campaigns.

### Exit criteria

Marketing reporting traces campaigns to leads, inspections, contracts, gross profit and membership conversions.

---

## Phase 5 — Financial operating system

**Goal:** create buyer-quality economics and management reporting.

### Deliverables

- 13-week rolling cash forecast.
- Five-year operating model with conservative/base/aggressive scenarios.
- Separate revenue models for:
  - roofing;
  - repairs;
  - membership;
  - referrals;
  - future software/licensing.
- Membership cohort waterfall.
- CAC/LTV by source.
- Gross profit per customer relationship.
- Software ROI model.
- Headcount-hours-saved model.
- Monthly owner/board dashboard.
- Standard KPI dictionary.
- Quarterly valuation snapshot.

### Core KPIs

- revenue;
- gross profit;
- EBITDA;
- cash;
- backlog;
- membership ARR;
- churn;
- CAC;
- LTV;
- CAC payback;
- recurring revenue percentage;
- repeat/referral revenue percentage;
- software-generated gross profit;
- customer concentration;
- lead-source concentration.

### Exit criteria

Every major growth or valuation claim can be reconciled to documented financial inputs.

---

## Phase 6 — SOPs, management depth and owner independence

**Goal:** reduce key-person risk and make the company operable without one owner or rainmaker.

### Deliverables

- SOPs for:
  - storm campaign;
  - lead qualification;
  - rep assignment;
  - inspection;
  - proposal;
  - claim documentation;
  - production handoff;
  - membership enrollment;
  - annual inspection;
  - renewal;
  - referral;
  - complaint handling;
  - manager review.
- Software-enforced required next actions and SLA alerts.
- Role scorecards.
- Daily sales pulse.
- Weekly pipeline review.
- Monthly operating review.
- Quarterly strategy review.
- AI operating assistant grounded in approved SOPs.
- Management escalation rules.

### Exit criteria

Critical workflows continue consistently when individual employees change.

---

## Phase 7 — IP, contracts and security

**Goal:** remove legal/technical diligence risks before the software becomes mission-critical.

### Deliverables

- Decide and document ownership of:
  - source code;
  - prompts/workflows;
  - customer data;
  - domains;
  - integrations;
  - data models;
  - trademarks/brands.
- Define any software licensing relationship between the creator and Delta Ridge.
- Define change-of-control treatment.
- Separate employment compensation, performance incentives and software/IP economics.
- Vendor/API license review.
- PII, GPS and audio retention policy.
- Role-based access.
- Audit logs.
- Secret management.
- Incident-response plan.
- Backup/restore procedure.

### Exit criteria

A buyer can determine exactly what Delta Ridge owns, licenses and depends on.

---

## Phase 8 — Exit readiness and optional software commercialization

**Goal:** maximize strategic optionality without distracting from proving the roofing business.

### Deliverables

- Acquisition-ready data room.
- Three years of normalized KPI history as it becomes available.
- Customer/member cohort history.
- Vendor and contract archive.
- IP documentation.
- Architecture and security documentation.
- Management-org chart and role responsibilities.
- Concentration-risk reporting.
- Buyer-quality monthly board packs.
- Software commercialization decision only after internal ROI is proven.

### Valuation framework

Keep separate:

1. operating-company EBITDA value;
2. recurring-membership quality/predictability;
3. proprietary software strategic value;
4. optional future licensing revenue.

Do not apply SaaS multiples to ordinary roofing revenue.

---

## 12-month recommended sequence

### Days 0–30

1. Finish Phase 0 reliability.
2. Establish canonical Lead 360.
3. Finalize RoofCare product/pricing/economics.
4. Build installed-customer database.
5. Lock IP/compensation framework.
6. Create KPI dictionary and Revenue Leakage dashboard.

### Days 31–90

1. Launch historical-customer RoofCare campaign.
2. Start intelligence-lead vs canvassing controlled test.
3. Deploy automated review/referral/social engine.
4. Complete 13-week cash forecast and five-year financial model.
5. Begin monthly board-style operating review.

### Months 3–6

1. Prove membership renewal and cohort economics.
2. Launch customer portal.
3. Scale lead-quality-adjusted rep assignment.
4. Deploy CAT/storm campaign automation.
5. Quantify software-generated gross profit and labor savings.

### Months 6–12

1. Scale membership.
2. Reduce random door-knocking materially.
3. Increase recurring revenue percentage.
4. Improve EBITDA and cash conversion.
5. Reduce owner/key-person dependence.
6. Maintain acquisition-ready data room and quarterly valuation snapshots.

---

## Non-negotiable operating principles

- No screen says **Synced**, **Verified**, **Current**, **Live** or **Confirmed** without objective support.
- No AI system silently changes material customer/claim facts.
- No original evidence image/document is overwritten.
- No lead-source or rep-performance claim is accepted without measurable outcomes.
- No recurring-revenue valuation is presented without churn and contribution-margin data.
- No software/IP ownership is left ambiguous.
- No feature is considered valuable until it improves gross profit, cash flow, retention, customer lifetime value or enterprise value.
