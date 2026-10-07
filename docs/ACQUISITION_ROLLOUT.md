# Acquisition rollout and owner demo

## Deployment order

1. Review the audit and preserve current deployment rollback identifiers. Use staging first.
2. `npm ci && npm run typecheck && npm run lint && npm test && npm run build`
3. With Supabase authenticated: `supabase db push --dry-run`; inspect pending migrations and the actual remote history before `supabase db push`.
4. Run `supabase test db` against a local/staging reset only. Never run `db reset` on production.
5. Configure server secrets through the provider's secret manager: `PUBLIC_ACQUISITION_ORG_ID`, `PUBLIC_ACQUISITION_ORIGINS`, `TURNSTILE_SECRET_KEY`. Keep service keys server-only. Configure `VITE_TURNSTILE_SITE_KEY` in the frontend environment. No shared secret belongs in a campaign URL.
6. Deploy `public-inspection-request`, `confirm-inspection-request`, `trigger-storm-campaign`, `autonomous-ad-buyer`, `property-enrichment`, `review-acquisition-engine`. Then deploy matching UI.
7. Verify production origin and challenge configuration. Public intake intentionally fails closed without required settings.

## Test and demonstration

- Owner/manager opens `/acquisition`; use a campaign source and public partner code to create a link.
- In a separate signed-out browser, open the link. Lookup an approved test address or skip lookup. Missing storm records must remain unknown.
- Request an inspection with authorized test contact details. Do not create a record with a real uninvolved homeowner's information.
- Verify receipt says request saved and appointment unbooked.
- Repeat request key in staging: exactly one request/lead/activity. Drop network after server commit and retry: no duplicate.
- Manager sees name, address, contact, preferred day and source; click Open lead and verify canonical CRM mapping.
- Agree a time, confirm; check appointment is assigned to an eligible active rep with no overlap. Retry confirmation: same booking.
- Existing inspection → EagleView → proposal → sold must be demonstrated separately. Imagery requires a real successful EagleView response; no portal sign-in or merged code substitutes for that check.
- Sold transition queues review/referral tasks, without sending a message. Verify job completion before contacting customer; use actual business review link.
- Record actual spend. Verify CPL/CAC math and dates; with no spend, costs remain unknown.
- Test wrong organization, signed-out manager, missing consent, expired CAPTCHA, rate-limit overflow and provider errors.

## Limits and rollback

- Production not verified until deployment and smoke test succeed. No paid advertising launches or messages were sent by this work.
- Campaign drafts do not mean ads delivered. Requests do not mean appointments. Weather evidence does not mean damage.
- Current confirmation respects appointment overlap, not travel time, calendar integration, business hours or complete territory/capacity optimization. These remain next-phase work.
- The rate bucket uses trusted ingress `x-real-ip`; when absent, a shared bucket limits throughput. Verify gateway header behavior before scaling.
- Rate-limit records need a retention/cleanup schedule. Configure after ingress verification.
- Undo UI by restoring prior deployment. Keep newly persisted request data. Disable public intake by clearing server acquisition configuration; do not drop populated tables.
- Property-intelligence tenant protections should stay enabled. Retiring simulated enrichment and unverified paid promotion is deliberate; do not restore fabricated writes as a workaround.

Definition of done: a signed-out authorized request persists once, manager confirmation books once, the assigned rep can complete the real inspection/proposal workflow, and owner reporting reconciles to actual records and spend on the deployed release.
