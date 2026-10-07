# Delta Ridge acquisition audit — October 7, 2026

Recommendation: complete and verify the homeowner request → manager confirmation → inspection workflow before allocating acquisition spend. This branch implements that workflow and repairs misleading acquisition paths. It does **not** establish that the complete six-channel acquisition recommendation is operational in production.

## Evidence boundary

- Audited baseline: `ae80bfe4777369d885923bb11ba826d7b5527125`, `nedpearson/DeltaRidge/main`.
- Production browser: `/free-roof-check` loads its address form; `/manager` requires sign-in in this browser. No authenticated CRM records were inspected.
- Source inspection covers public intake, CRM persistence, appointment scheduling, source economics, property scores, property enrichment, storm campaign dispatch, ad promotion, review/referral flows, integration configuration and CI.
- Baseline frontend: production build passed; 72 test files / 1,021 tests passed.
- New intake tests: frontend validation, safe attribution, undefined economics, receipt after persistence, retry using the same request key. Database assertions exist but require a Supabase/Postgres environment.
- Production Vercel/Supabase credentials are unavailable in this workspace. No new migration, function or UI deployment is claimed live.

## Findings and changes

| Area | Verified source behavior | Change / outstanding verification |
|---|---|---|
| Public booking | Schedule Free Inspection button has no handler | Replaced with contact form, server persistence and an explicit request receipt; date is never represented as booked |
| Exposure lookup | Public security-definer RPC accepts arbitrary organization and inserts a generated address column | Service-only read RPC, server-selected organization, CAPTCHA, origin checks, rate limit; lack of match returns unknown |
| Persistence | Existing ingest endpoint writes several CRM objects without a transaction | New public request RPC writes property/customer/lead/request/activity in one transaction and serializes retries; existing external webhook remains separate |
| Confirmation | Existing auto-book function requires a social conversation | New manager confirmation function authenticates actor, checks membership in SQL, locks request, uses existing conflict-aware rep scheduler; retries return existing booking |
| Contact authorization | Request collection lacked a complete UI | Required disclosure and timestamp saved with request; no marketing opt-in is inferred; no automatic message sent |
| Attribution | Existing reporting treats attempted contacts as appointments | Source reporting uses actual appointments, counts each lead once, scopes organization and surfaces query failures |
| Financial claims | Source report multiplies revenue by 35% and calls it GP | Removed fabricated source GP; unverified revenue stays unverified. Existing broad lead economics still has assumed margin, now labeled; its stage/revenue model needs further remediation |
| Acquisition reporting | No dated homeowner-request cohort tied to spend | New dated cohort, distinct leads with appointments, sold count, actual spend entry and blended CPL/CAC. Spend by date is not causal attribution |
| Enrichment | property-enrichment writes John Doe and a simulated 2010 roof permit | Retired simulated endpoint with honest unavailable response; real lookup-property/lookup-contact providers preserved; no production contamination asserted or purged |
| Referral neighbors | Function reads nonexistent lead.location and writes invalid open status/fields and fixed score 95 | Uses canonical property geometry and target status; no fabricated score or implied homeowner interest; manager/service access enforced |
| Review workflow | Logs sent without a provider delivery; uses wrong activity/ledger columns | Internal sold-transition trigger queues idempotent office review/referral tasks; UI exposes completion, no delivery claim; verify job completion before outreach |
| Storm advertising | Creates campaign shell but no complete ad-set/creative/geographic targeting; writes mismatched fields | Builds org-specific drafts only with qualifying recent storms and nearby properties; no paid launch or inferred roof damage |
| Automatic promotion | Can promote based on attributed revenue without a verified spend/budget workflow | Disabled pending provider spend verification and management-reviewed ad configuration |
| Property intelligence | Latest security-definer RPC lacks tenant filter; default execute not revoked in its migration | Forward migration adds tenant/deletion filters, fixed search path and authenticated/service grants; evidence RLS and score view invoker mode. Live exploitability was not tested |
| GitHub database CI | Run 37403700664 database test expected old score ~87; received 10; E2E skipped | Fixture now writes current property_storm_evidence and verifies 2×20 + 75×0.5 = 77.5. CI rerun required |
| Performance | Baseline main JS bundle exceeds 1 MB uncompressed | Acquisition manager route lazy-loaded. Existing initial bundle needs a separate focused optimization |

## What still prevents a full production claim

1. Apply and execute both forward migrations against staging and run database/RLS assertions. Verify actual production migration history before pushing.
2. Configure the organization ID, allowed origins and Turnstile secret on Supabase; browser site key on Vercel.
3. Deploy both new functions and repaired functions. Match frontend and backend releases; the old public exposure RPC is intentionally no longer anonymous.
4. Verify one authorized test request, retry, manager booking, representative assignment, inspection, EagleView request, proposal and sold transition in production.
5. Finish and verify paid channel integrations: Google Ads/LSA intake, Meta ad account/ad-set/creative/targeting, spend ingestion and conversion events. No advertising was activated.
6. Verify communication provider, sender identity, suppression and delivery webhooks before automated calls/SMS/email. Existing contact enrichment is not outreach authorization.
7. Finish business profile/review URL configuration, partner registry/reward administration, campaign-level deduplicated revenue attribution and actual job-cost gross profit.
8. Replace stale global lead-economics and Storm OS counts with timestamped stage records and real operational data. Existing Storm OS can swallow errors and displays zero for unimplemented follow-ups/integration alerts.
9. Validate scheduled weather ingestion against production URLs. Existing cron/trigger source uses local `http://kong:8000` URLs; production execution was not verified.
10. Inspect authenticated mobile/desktop UX and existing integration health. The full application was not authenticated in this browser.

## Owner decision

Present this as an audited implementation with a controlled rollout, not as a fully active autonomous lead-generation business. The competitive advantage is a measurable exclusive homeowner funnel combined with evidence-based territory selection. No claim is made that every property has contact data, roof damage, insurance eligibility or a calibrated conversion probability.
