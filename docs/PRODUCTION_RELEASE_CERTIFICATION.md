# Delta Ridge Production Release Certification

A green build is necessary, but it is not proof that the live roofing workflow works. This checklist is the release gate for the lead engine, maps, integrations, and second-device office workflow.

## 1. Security gate

- Rotate any EagleView credential that has ever appeared in repository history.
- Production EagleView credentials exist only as Supabase secrets:
  - EAGLEVIEW_CLIENT_ID
  - EAGLEVIEW_CLIENT_SECRET
  - EAGLEVIEW_ENV=production
- No server credential has a VITE_ prefix.
- Mapbox browser token is a public pk.* token restricted to approved production origins.
- Supabase service-role key never reaches the browser bundle.
- Contact-provider keys remain Edge Function secrets.
- Roofr/Zapier hook remains server-side only.

**Release fails** if a committed credential is merely deleted but not rotated.

## 2. Current-location lead search

On a physical phone with Location Services enabled:

1. Open Leads.
2. Tap **Use my location & build list**.
3. Confirm the screen displays a live/current-location state and reported accuracy.
4. Set:
   - Radius = 1 mile
   - Minimum hail = 1.00"
   - Storm window = Last 24 months
   - Roof at least = 12 years
5. Verify every returned property is within the selected radius of the acquired GPS fix.
6. Change radius to 5 miles and verify the search expands around the same GPS center.
7. Move materially, tap **Refresh from my location**, and verify the search center changes.
8. Deny location permission and verify Delta Ridge does not silently use the office/service-area center.

Cached data may remain visible only when labelled as previous/cached data. It must not be represented as the current nearby search.

## 3. Map certification

### Mapbox

- Street map renders.
- Satellite map renders.
- Public token is accepted on production origin.
- Current-location marker appears after geolocation permission.
- Search-radius ring is centered on the same GPS fix used by the lead engine.
- Door pins stay aligned while panning/zooming.
- Storm overlays remain below actionable door markers.
- Fit control includes the active lead set/search area.
- Attribution remains visible.
- Location control behaves correctly when permission is denied.

Mapbox GL JS current documentation confirms GeolocateControl uses the browser Geolocation API, requires secure HTTPS in modern browsers, supports high-accuracy positioning, user tracking and an accuracy circle.

### Static fallback

- Disable WebGL or Mapbox GL intentionally.
- Verify the static map still plots the same property coordinates.
- Verify search radius and current-location context remain understandable.
- Offline/failed tiles must not be represented as a live map refresh.

## 4. Lead-engine data sources

For one Golden Lead, verify each source independently.

### Official hail

- NWS/official ground report is labelled as a report.
- Show event date, hail size and report location/distance.
- Never state the report proves hail hit the exact roof.

### Radar hail

- NOAA NCEI SWDI/NEXRAD radar-estimated hail remains labelled as an estimate.
- Ground corroboration remains separate.
- Do not relabel SWDI as gridded MRMS MESH.

### MRMS

Gridded MRMS MESH is a separate product and is not certified merely because SWDI radar hail works. NOAA currently publishes operational MESH GRIB2 products. If Delta Ridge requires property-grid MRMS/MESH, a server-side GRIB2 ingestion service must be deployed and tested separately.

### Permit / roof age

- Roof-age basis points to the actual permit date/provider.
- Re-roof permits after the qualifying storm suppress the opportunity where appropriate.
- No permit must be shown as "unknown/not established," never as "no reroof."

### Assessor / parcel

- Owner name has provider, retrieval date and confidence.
- Occupancy is a signal with basis, not a statement about who is physically home.
- Assessed value is never described as fair-market value.

## 5. Lead intelligence

Every candidate shows three independent signals:

- Property Opportunity
- Homeowner Intent
- Contactability

Rules:

- None is called a sale probability.
- Contactability falls to blocked/zero for DNC/opt-out.
- Looked-up phone != permission to call/text.
- Intent changes only from observed workflow events.
- Property Opportunity remains traceable to storm/roof/property evidence.

Verify the **Why This House / Show Proof** panel exposes:
- storm source/date/distance;
- roof-age source/date;
- owner/property source;
- contact source;
- explicit limitations.

## 6. Contact enrichment

For each configured provider:

- authenticated Edge Function call succeeds;
- organization boundary is respected;
- source is returned accurately;
- wrong/disconnected/DNC statuses are not reset by refresh;
- no provider result automatically grants contact consent;
- provider failure leaves manual workflow available;
- provider cost/failure is visible in health/logging.

Do not call the integration "connected" until a real provider request succeeds.

## 7. EagleView

Production certification requires a real property supported by the production EagleView entitlement.

1. Settings/Health must not show Working until traffic succeeds.
2. Search imagery by real property coordinates.
3. Verify production, not sandbox, response.
4. Verify at least one capture if that property is covered.
5. Verify capture date, view type and GSD/resolution metadata.
6. Open the actual image through the authenticated proxy.
7. Verify credentials never appear in browser network responses.
8. Verify no imagery is called live/current unless the capture metadata supports that wording.
9. Verify no roof-condition conclusion exceeds image resolution.

The EagleView developer portal currently exposes high-resolution ortho/oblique imagery, coverage APIs, property data and measurement-order capabilities. Entitlement must be verified per production account.

## 8. Roofr

- Inbound Zapier event reaches Delta Ridge.
- Duplicate delivery does not create a duplicate event.
- Correct lead is linked using stable external IDs.
- Outbound push is enabled only after real Create Job and Customer succeeds.
- Delta Ridge does not claim a Roofr job exists merely because Zapier accepted the hook.
- Proposal sent/viewed/signed/lost events update the linked lead once.
- Lead economics counts signed value only according to documented attribution rules.

## 9. Appointment brief

For a booked lead:

- brief loads known homeowner/property facts;
- storm/permit evidence is included;
- uncertainty is listed under Verify on site;
- contact restrictions remain visible;
- brief never labels opportunity score as close probability;
- inspection next actions link to the existing workflow.

## 10. Lead economics / outcome attribution

Manager → Lead economics must reconcile to server records.

Check at least:
- target;
- contacted;
- engaged;
- appointment;
- inspected;
- proposal;
- won;
- lost.

Contract value may count only:
- a signed Roofr proposal; or
- a Delta Ridge lead explicitly marked sold with an immutable estimate.

Estimated gross profit is not cash collected. It must remain labelled estimated until job-cost actuals exist.

## 11. Offline + second-device Golden Lead

Rep device:

1. Sign in.
2. Acquire GPS.
3. Build nearby list.
4. Start route.
5. Go offline.
6. Promote one Golden Lead.
7. Record five door/activity events.
8. Add typed note.
9. Add photo.
10. Add voice note.
11. Set appointment.
12. Kill app.
13. Reopen offline.
14. Confirm all work remains.
15. Sign out with pending work.
16. Sign back in as same rep.
17. Restore connectivity.
18. Let outbox drain.
19. End route.

Manager device:

- same lead appears exactly once;
- activity count matches exactly;
- photo and voice records remain linked;
- appointment exists;
- route/GPS trail exists;
- opportunity/intent/contactability fields exist;
- no false Synced state appears before server acknowledgement.

Then replay one mutation/event and verify idempotency.

## 12. Automated release gate

Required green:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

GitHub production backend deployment additionally:

- applies migrations;
- deploys required Edge Functions;
- verifies protected functions reject anonymous calls.

Automated checks do **not** replace the physical-device Golden Lead or real EagleView/Roofr provider test.

## Release decision

A release may be called **Live Production** only when:

- CI is green;
- production migrations are applied;
- production Edge Functions are deployed;
- browser Mapbox + GPS search passes on a physical phone;
- Golden Lead two-device sync passes;
- EagleView succeeds against a real production-entitled property;
- Roofr inbound/outbound flows are proven if enabled;
- no unresolved blocker is represented as Connected, Working, Live, Current, Verified or Synced.
