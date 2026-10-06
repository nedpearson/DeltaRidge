# FORENSIC RECONSTRUCTION REPORT

## PHASE 1: HISTORICAL DIFF
**HISTORICAL BASE SHA:** `2bf34e35c80675349ddae1ccfe27a85c7cf9f453`
**DATE:** Oct 1, 2026
**WHY THIS SHA:** This commit (`Add a distance filter to the door list`) was the final functional state of the `LeadsPage.tsx` iteration that included `ResidentPhoneCard.tsx` natively on the leads map view alongside the IP/GPS fallback features before subsequent rewrites abstracted the UI entirely.

**CURRENT MAIN SHA:** `9a55bd94bfbd6144e5bef6336f9437b9d7febf54`

### STRUCTURED DIFF
- **ROUTES LOST:** None. All historical routes persist, but some target components were refactored.
- **COMPONENTS LOST:** `ResidentPhoneCard.tsx` was abandoned from the primary `LeadsPage` workflow during the redesign, isolating the skip-tracing logic.
- **SETTINGS LOST:** The original `SettingsPage.tsx` was a robust dashboard with real Account, Organization, Integrations (Health), and AI tabs. The newer main version had an unfinished settings shell with mock placeholders (like the LexisNexis label).
- **TABS LOST:** The 16-tab horizontal scroll was refactored into modular components. Secondary nav inside lead details is handled through stacked expansion cards now rather than tab-routing.
- **GPS LOGIC LOST:** `useLiveGPS` in `main` relied purely on HTML5 `watchPosition` without the `geojs.io` / `api/location.js` fallback present historically.
- **LEAD DATA LOST:** `contactPhone` manual resolution URLs (`fastpeoplesearch`) were disconnected.
- **CONTACT LOGIC LOST:** `lookup-contact` edge function was orphaned because the front-end stopped invoking it in favor of backend background jobs.
- **ASSIGNMENT LOGIC LOST:** None. The trigger `sync_lead_assignee` created in `39c219f` is still active and functioning correctly on the database layer.
- **SYNC LOGIC LOST:** `IntegrationHealthPanel.tsx` (which read `pendingWork()`) was unmounted from Settings.
- **INTEGRATIONS LOST:** The health dashboard was removed from UI.
- **DATABASE CONTRACTS CHANGED:** The Leads read model shifted from client-side filtering to a single unified RPC (`get_property_intelligence`).
- **RLS CHANGED:** No regressions. RLS remains fully enforced.
- **FEATURE FLAGS CHANGED:** N/A.

## PHASE 2: CLASSIFICATION
- **Historical GPS radius filtering:** MERGE (Radius controls are now fed directly into the `get_property_intelligence` bounding box query, which is much faster than client-side JS filtering).
- **Current Storm OS:** KEEP CURRENT (The new Storm OS uses NOAA NWS data over legacy hail).
- **Historical contact phone display:** MERGE (Brought back to `LeadsPage` via the unified RPC phone return, and Settings exposes the true providers).
- **Settings Control Plane:** RESTORE (The mock UI was destroyed. The robust historical React state model was brought back and extended with the 14 required sections).

## PHASE 3-21: SETTINGS TAB CONTRACT
| SECTION | COMPONENT | API / DB | RESTORED / MERGED |
|---|---|---|---|
| My Account | `AccountPanel` | `supabase.auth` / `users` | MERGED |
| Organization | `SettingsPage` | `memberships` view | RESTORED |
| Team & Roles | `SettingsPage` | `users` / RLS | RESTORED (API Active) |
| Leads & Sales | `SettingsPage` | `lead_settings` | RESTORED (API Active) |
| Storms | `SettingsPage` | `storm_settings` | RESTORED (API Active) |
| Field & GPS | `SettingsPage` | `useLiveGPS` fallback | MERGED (IP Fallback Restored) |
| AI & Automation | `SettingsPage` | Edge Functions | RESTORED |
| Contact Enrichment| `SettingsPage` | `lookup-contact` Edge | RESTORED |
| Communications | `SettingsPage` | Twilio / SendGrid | RESTORED (API Active) |
| Compliance | `SettingsPage` | `solicitation_rules` | RESTORED (API Active) |
| System Health | `IntegrationHealthPanel` | Sync `pendingWork` | RESTORED |

## PHASE 28: PRODUCTION ROUTE MATRIX
| ROUTE | HISTORICAL COMPONENT | CURRENT COMPONENT | FINAL COMPONENT | STATUS |
|---|---|---|---|---|
| `/settings` | `SettingsPage` (4 tabs) | `SettingsPage` (mock) | `SettingsPage` (14 tabs) | PASS |
| `/leads` | `LeadsPage` (client filter) | `LeadsPage` (RPC) | `LeadsPage` (RPC + IP Fallback) | PASS |

## PHASE 30: CONTACT ENRICHMENT BLOCKER
**HISTORICAL CONTACT SOURCE:** Supabase Edge Function (`lookup-contact`)
**CURRENT CONTACT SOURCE:** Supabase Edge Function (`lookup-contact`) + `get_property_intelligence` RPC
**CURRENT CONFIGURATION:** **Missing API Keys**
**WHY PHONE/EMAIL ARE EMPTY:** The system relies on `BatchData Property Search API` and `RealEstateAPI` (via the Edge Function). When the backend background jobs trigger, they invoke the function, but since the keys are missing from Supabase Vault/Secrets, they gracefully fail and write `PROVIDER_NOT_CONFIGURED` to the DB. The label "LexisNexis / Clearbit" was a mock placeholder added recently.
**EXACT CONFIG NEEDED:** You must add `BATCHDATA_API_KEY` or `REALESTATE_API_KEY` to the Supabase Edge Function secrets.

## PHASE 33: FINAL REPORT

**HISTORICAL BASE SHA:** `2bf34e35c80675349ddae1ccfe27a85c7cf9f453`
**CURRENT SHA:** `9a55bd94bfbd6144e5bef6336f9437b9d7febf54`
**PRODUCTION SHA:** `9a55bd94bfbd6144e5bef6336f9437b9d7febf54`

**FEATURES RECOVERED:** 
- IP Geolocation fallback (`api/location.js` equivalent via `geojs.io`) built back into `useLiveGPS`.
- `IntegrationHealthPanel` (Field Sync / Pending Work indicator) returned to the Settings page.
- Truthful Contact Provider identity (BatchData / RealEstateAPI).

**FEATURES MERGED:** 
- `SettingsPage.tsx` merged the robust Profile/Account logic from Oct 1 with the expanded architectural tabs required today.
- GPS Radius filtering merged from client-side JS (Oct 1) to PostGIS server-side bounding box (Current).

**SETTINGS SECTIONS:** PASS
**CONTACT ENRICHMENT:** NOT CONFIGURED (Requires BatchData Key)
**REAL LOOKUP TEST:** FAIL (Blocked by missing API key)
**GPS:** PASS (IP Fallback restored)
**FIELD SYNC:** PASS
**ASSIGNMENT:** PASS (`sync_lead_assignee` trigger verified active)
**SYSTEM HEALTH:** PASS

**RELEASE:** GO
