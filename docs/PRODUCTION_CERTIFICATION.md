# Delta Ridge — Production Certification

Delta Ridge is **production-certified only after every load-bearing check below is
green against the deployed environment**. Passing CI, having credentials present,
or successfully deploying an Edge Function is not enough.

Target web app: `https://deltaridge.bridgebox.ai`

## 0. Release identity

Record this before testing:

- Git commit SHA:
- Vercel deployment:
- Supabase project: `udrxvpkihkbrudvwggpr`
- Tester:
- Rep test account:
- Manager/admin test account:
- Test date/time:

A certification result is tied to one exact commit/deployment. A later release
must be re-certified.

---

## 1. Security gate — must pass before production traffic

### EagleView credential rotation — REQUIRED

An EagleView client credential previously existed as a fallback literal in git
history. The current code no longer contains a fallback credential and reads
credentials from Edge Function secrets only.

**Before this release may be called production-ready:**

1. Revoke/rotate the previously exposed EagleView client secret in EagleView.
2. Store only the replacement values as Supabase Edge Function secrets:
   - `EAGLEVIEW_CLIENT_ID`
   - `EAGLEVIEW_CLIENT_SECRET`
   - `EAGLEVIEW_ENV=production` only when the account is entitled for production imagery.
3. Run a real authenticated discovery request and a real image request.
4. Confirm the Integration Health row records observed successful traffic.

Removing a credential from the current source tree does not invalidate copies in
git history; rotation is mandatory.

### Server-side secret inventory

Confirm values exist only where required and none are exposed with a `VITE_`
prefix:

- `SUPABASE_SERVICE_ROLE_KEY`
- `EAGLEVIEW_CLIENT_ID`
- `EAGLEVIEW_CLIENT_SECRET`
- `ZAPIER_ROOFR_HOOK_URL`
- approved commercial contact-provider credentials, if enabled
- optional provider/API secrets actually in use

### Browser-safe configuration

Confirm:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MAPBOX_PUBLIC_TOKEN`
- `VITE_STORM_PROVIDER=noaa`
- `VITE_RADAR_HAIL=swdi` when radar-estimated hail is intended

The Mapbox public token must be URL-restricted in the Mapbox account.

---

## 2. Database/schema gate

Production was verified through the prior schema set on 2026-09-24. Any
migration added after that verification is **pending until independently proven
applied**.

For this release specifically verify that the objects from
`20260926_0033_lead_intelligence_ops.sql` exist:

- table `contact_lookup_events`
- view `lead_quoted_economics`
- RLS policy on `contact_lookup_events`
- authenticated SELECT grant on `lead_quoted_economics`

Do not use ordinary `supabase db push` against the existing production
migration history until the history mismatch described in `supabase/APPLY.md`
has been reconciled.

After applying a new migration, verify its objects directly in PostgreSQL rather
than assuming an installer succeeded.

---

## 3. Edge Function deployment gate

Deploy and verify all current functions:

- `eagleview-imagery`
- `lookup-contact`
- `lookup-property`
- `roofr-events`
- `roofr-push`

Use `scripts/deploy-functions.ps1` on Windows or
`scripts/deploy-functions.sh` elsewhere.

Required negative tests:

- unauthenticated EagleView request -> rejected
- unauthenticated property lookup -> rejected
- user without active org membership -> rejected
- contact lookup without approved commercial entitlement -> blocked
- contact lookup from org A cannot read a cached contact from org B
- bad Roofr inbound token -> rejected

Required positive tests:

- authenticated property lookup returns a response for an entitled provider
- approved contact lookup records a non-PII operational event
- EagleView discovery + full-resolution image succeed for a property covered by
  the production entitlement
- Roofr outbound job/customer flow is acknowledged by the downstream system
- Roofr inbound event appears on the correct Delta Ridge lead

---

## 4. Current-location lead engine gate

Test with Location Services **allowed**:

1. Open Leads -> New.
2. Confirm the UI says `Using your current location`.
3. Confirm reported accuracy is plausible.
4. Confirm the map displays the cyan search-radius circle.
5. Change radius and verify the circle and lead population update.
6. Change minimum hail size, storm window, and roof age and verify the same GPS
   center is retained.
7. Confirm the lead engine only returns properties inside the circular radius,
   not merely inside the surrounding bounding box.
8. Confirm rep search radius does not change the property-to-storm evidence
   radius.

Test with Location Services **denied/off**:

- no new location-specific list is generated
- filters cannot imply a current nearby search
- cached data, if shown, is clearly old/cached rather than current
- the UI provides an enable/retry path
- starting/stopping a Field Route does not silently become the location-search
  permission control

Test after materially moving the device:

- refresh from current location
- verify search center moves
- verify stale previous-center results are not described as current

---

## 5. Mapping gate

### Mapbox

Verify on production domain:

- interactive map loads
- streets layer loads
- satellite layer loads
- current-location marker is correct
- search-radius circle is centered on the current GPS fix
- lead pins correspond to lead coordinates
- storm overlays correspond to storm event coordinates
- fallback/static map projects the same points correctly
- map failure degrades to the fallback instead of blanking the workflow

Do not mark Mapbox `Working` in health merely because a token exists. A live
tile/style request must be observed if a green/healthy state is ever added.

### Navigation

Verify property navigation opens the expected external maps destination and does
not mutate the search center.

---

## 6. Storm intelligence gate

Run one real lead-engine search and inspect its source breakdown.

Verify:

- NWS Local Storm Reports return or truthfully report no events
- NEXRAD/SWDI radar-estimated hail returns or truthfully reports unavailable
- official ground reports remain labelled as official reports
- radar estimates remain labelled as radar estimates
- the app never translates a nearby report into "hail confirmed at this roof"
- storm window and size floors shown in UI match the query that actually ran

### MRMS/MESH

Gridded NOAA MRMS/MESH is **not production-complete unless a real server-side
GRIB2 ingestion pipeline is deployed and tested**. Current SWDI/NEXRAD radar
coverage must not be relabelled as MRMS.

If MRMS is not deployed, the health screen must continue to say so.

---

## 7. Property/contact gate

Verify on at least three real test properties:

- parcel/property identity
- recorded owner
- owner-occupancy evidence
- roof/permit age evidence
- property attributes from the licensed provider when available
- multiple data sources do not silently overwrite contradictions

Contact enrichment must satisfy all of the following:

- commercial-use entitlement confirmed in Settings
- credential stored server-side
- org isolation
- provider result records source/provenance
- lookup result is NOT treated as permission to call/text/email
- direct contact actions remain governed by consent/opt-out/DNC/calling-window logic
- manual phone entry does not falsely claim it came from a provider or homeowner

---

## 8. EagleView gate

Use one property supported by the production EagleView account.

Verify:

1. Property page visibly exposes the EagleView imagery interface.
2. Discovery request succeeds.
3. At least one real capture is returned when entitlement/coverage permits.
4. Capture date is displayed.
5. Image request succeeds and renders.
6. Orthographic/oblique metadata is not invented when unavailable.
7. Before/after comparison only appears when actual before/after captures exist.
8. Old/insufficient imagery does not claim current roof condition.
9. Integration Health reflects actual request results.

If the account only has sandbox coverage, label it sandbox. Do not report
production imagery availability from a sandbox success.

---

## 9. Ultimate Lead gate

For each test lead verify the three signals remain separate:

- Property Opportunity
- Homeowner Intent
- Contactability

Verify:

- high property score + no homeowner interaction is not an Ultimate Lead
- strong intent + poor/no contactability is not silently promoted
- DNC/opt-out produces a Blocked state
- `Why this house?` lists actual ranking reasons
- `Show the proof` opens underlying property/evidence
- no score is described as probability of closing/winning

---

## 10. Appointment workflow gate

For a qualified lead:

- set appointment
- verify appointment persists offline
- verify Appointment Brief shows address/homeowner/time
- verify brief carries property reasons
- verify property-evidence link works
- verify brief explicitly separates evidence from unconfirmed roof damage/cause

---

## 11. Roofr/Zapier gate

Verify stable identity through the full loop:

Delta Ridge lead -> outbound request -> Zapier/Roofr -> Roofr identifiers saved
-> inbound Roofr event -> same Delta Ridge lead.

Test duplicate delivery and retry.

Required:

- no duplicate job/customer from retry
- no matching solely by homeowner name
- failed integration remains visible/retryable
- proposal sent/viewed/signed/lost status is sourced to actual Roofr events

---

## 12. Offline / second-device Golden Lead

Rep device:

1. Sign in.
2. Go offline.
3. Start route.
4. Create/work one synthetic Golden Lead.
5. Record five door activities.
6. Capture GPS fixes.
7. Add typed note.
8. Record voice note.
9. Add photo.
10. Set follow-up/appointment state.
11. Kill app.
12. Reopen offline and verify all work remains.
13. Sign out with pending work.
14. Sign back in as same rep.
15. Restore connectivity.
16. Let queue drain.
17. End route.

Manager device:

- open the same lead independently
- verify each logical event appears exactly once
- verify route/GPS trail
- verify media records
- verify current state
- verify attribution to the correct rep/org
- verify no queue item silently disappeared

Also test signing in as another user while the first user's queue exists; work
must not be re-attributed.

---

## 13. Financial/outcome attribution gate

`lead_quoted_economics` represents **quoted economics**, not realised
accounting profit.

Verify:

- latest estimate version is selected
- sell price matches estimate
- estimated job cost matches estimate
- quoted gross margin = sell price - estimated job cost
- dashboards label it `quoted` / `estimated` until production closeout/job-cost
  data exists

Do not report "actual gross profit per lead" until actual collected revenue and
final job cost are present and reconciled.

---

## 14. CI/release gate

Required green on the exact release SHA:

- TypeScript typecheck
- ESLint
- unit tests
- Playwright tests
- production build

Then test:

- iPhone-sized viewport
- Android-sized viewport
- tablet
- Surface/tablet
- laptop
- desktop

Verify no:

- clipped addresses
- hidden text
- bottom-nav overlap
- accidental horizontal page scrolling
- dead Fix Now action
- unreadable badges
- stale old palette
- low-contrast essential metadata

---

## 15. Production sign-off

Only mark the release **CERTIFIED** when all required rows below are evidence-backed.

| Area | State | Evidence |
|---|---|---|
| CI | Pending | |
| Web deployment | Pending | |
| DB migration | Pending | |
| Edge Functions | Pending | |
| EagleView credential rotated | Pending | |
| Current-location search | Pending | |
| Mapbox live map | Pending | |
| NWS ground hail | Pending | |
| Radar hail | Pending | |
| Contact provider | Pending | |
| EagleView production imagery | Pending | |
| Roofr inbound/outbound | Pending | |
| Offline Golden Lead | Pending | |
| Second-device manager read | Pending | |
| Backup/restore | Pending | |

**CERTIFIED BY:**

**COMMIT SHA:**

**DEPLOYMENT:**

**DATE:**

Until these fields are filled from actual live tests, the truthful state is
`implemented / awaiting production certification`, not `live production complete`.
