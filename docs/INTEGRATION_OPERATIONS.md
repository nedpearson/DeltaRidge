# Integration operations

The health screen measures the last seven days of server traffic and acknowledged device writes. A queued update, an API credential, an empty imagery discovery, and a Zapier POST are not evidence of completed work.

## Deployment

`Integration Operations` validates the worker on pull requests. Merging to main deploys the integration schema and these functions: integration-status, push-notifications, eagleview-imagery, lookup-contact, roofr-push, roofr-events and ingest-mrms. Only the new integration migration is applied; unrelated pending migrations are not pushed. The workflow then attempts the first MRMS import and push drain. Scheduled runs repeat every ten minutes; GitHub schedules can be delayed.

Production project: `udrxvpkihkbrudvwggpr`.

GitHub Actions secret | Purpose
--- | ---
SUPABASE_ACCESS_TOKEN | Deploy functions and the integration migration through the Management API
SUPABASE_SERVICE_ROLE_KEY | Trusted worker database access; never a frontend environment variable
EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET / EAGLEVIEW_ENV | Imagery API entitlement and environment; a report-portal subscription is separate
ZAPIER_ROOFR_HOOK_URL | Published Zap with Roofr create-job action
BATCHDATA_API_KEY or REALESTATE_API_KEY | Business contact-enrichment API account
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT | Device push signing keys and monitored provider contact

Existing Supabase provider secrets are preserved when the matching GitHub secret is absent. The worker requires its own Supabase service key and VAPID signing key in GitHub Actions. Provider secrets stored only in Supabase do not automatically reach GitHub.

To create push keys without printing or overwriting them:

```sh
python scripts/create-vapid-keys.py --subject mailto:YOUR_MONITORED_COMPANY_EMAIL
```

This writes an ignored, owner-readable `supabase/functions/.env.push`. Store its three values in the corresponding GitHub secrets, then run Integration Operations → deploy. Use the same key pair on the server and worker; changing keys requires device re-registration.

`MRMS_BOUNDS` is a repository variable containing `[west,south,east,north]`. The default covers Greater Baton Rouge. Maximum territory dimensions are five degrees per side. NOAA negative/missing values are retained as missing counts, never converted to a claim of zero hail. A current imported grid with entirely missing territory data is shown as unable to verify, even though decoding and import worked.

## Verify each row

1. Field sync: sign in, open diagnostics, retry saved work. Verify server acknowledgement before clearing the device. Property visits now use an idempotent database upsert.
2. EagleView: request imagery for a supported property and open the full-resolution image. 401 gets a token refresh; 429/5xx and transport errors get bounded retries. 403 is not retried. Zero captures do not count as usable imagery.
3. Roofr inbound: preserve the existing inbound token. Trigger an event in the published Zap and verify its processed receipt.
4. Roofr outbound: Settings → Integrations exposes the existing Roofr configuration. Set the server hook, publish a Zap that preserves `external_job_id`, enable outbound jobs, and send one eligible lead. The acknowledgement Zap must return `job_created` with that external ID. The health row stays unproven until Roofr confirms a job.
5. Supabase: the health check validates the current user and a live database read; client construction no longer reports success.
6. MRMS: run Integration Operations → mrms. Verify an imported grid and its coverage counts in Settings → Integrations. No NOAA API credential is required.
7. Contacts: run one lookup with a business provider. Provider HTTP failures and account-configuration errors reach the UI. Successful results are recorded per organization. Cached reads use caller RLS instead of global service-role reads.
8. Push: each user opens Settings → Notifications → Enable device alerts. The browser must grant permission. Send test alert queues a notification only for that user. Verify its push-service receipt after the worker runs. A receipt proves provider acceptance, not that the device displayed it. New lead assignments generate alerts; unchanged assignments do not duplicate them.

Push delivery is at most once per notification/device. Unknown transport outcomes are recorded and not automatically resent. Expired subscriptions are deactivated; the user can re-enable alerts. Only supported HTTPS browser push origins are accepted, and inactive organization memberships cannot receive messages.

## Verification and rollback

```sh
npm run typecheck
npm run test
npm run lint
npm run build
python -m pip install -r scripts/integration-worker-requirements.txt
python -m unittest discover -s tests/integration_worker -v
```

Database permissions and assignment notifications are covered by `supabase/tests/integration_operations.test.sql` in database CI. A real NOAA file was decoded locally; production imports and provider delivery still require successful workflow runs.

Rollback: restore the preceding Vercel deployment, disable Integration Operations scheduling, and redeploy the preceding edge-function versions. Retain the new tables and delivery receipts. If the lead-alert trigger causes an operational issue, remove only `lead_assignment_notification` from `leads`; do not delete queued field work, notifications or credentials.

Definition of done: all eight rows have verified production operations; contact and imagery entitlements are valid; Roofr confirms the created job; opted-in devices receive alerts; MRMS missing coverage is presented accurately.
