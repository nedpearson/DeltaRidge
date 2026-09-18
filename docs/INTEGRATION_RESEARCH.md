# Integration Research

**Researched:** 2026-09-18
**Researcher:** Claude (verified against live vendor documentation, not assumed)

Every claim below was checked against the vendor's own documentation on the date
above. Where a vendor's docs are silent, this document says so rather than
guessing. Re-verify before relying on anything here after roughly Q1 2027 —
CompanyCam in particular has a dated deprecation ahead.

---

## Executive summary

The workable, officially-supported integration loop for Delta Ridge is:

```
Delta Ridge app
      |  CompanyCam REST API (create project, upload tagged photos, upload handoff PDF)
      v
  CompanyCam  <--- bidirectional sync --->  Roofr
      |                                       |
      |                                       |  Zapier (one-way, Roofr -> out)
      |                                       v
      +--------------- webhook -------- Delta Ridge app (status events)
```

Two findings drove this design and both contradict common assumptions:

1. **Roofr cannot be written to via Zapier.** Inbound automation into Roofr does
   not exist on that path.
2. **CompanyCam is the write path,** because the Roofr <-> CompanyCam integration
   is bidirectional and CompanyCam exposes a real REST API.

---

## Roofr

| Item | Finding |
| --- | --- |
| Public REST API | **Not documented.** No public API reference could be located. |
| Zapier support | Yes, but **outbound only**. |
| CompanyCam integration | Yes, **bidirectional**. |
| Plan tier for Zapier | **Not stated** in docs; help article directs users to their Account Manager, implying account-level enablement. |

### The critical constraint

Roofr's own Zapier connection guide states verbatim:

> "Zapier integration cannot: Share information from another platform to Roofr
> (one-way data only, from Roofr to another platform)."

**Implication:** any design that says "push the office package into Roofr via
Zapier" is not buildable. Do not plan around it.

### What Zapier *is* good for

Outbound Roofr events feeding our database. The documentation names
`Proposal Sent` as a trigger event; a comprehensive trigger/action list is not
published, so the real inventory must be confirmed in the Zapier editor against
a live Roofr account.

Use it for: proposal sent, proposal signed, and job status changes flowing back
into Delta Ridge so a rep sees office progress without calling the office.

### Open questions for Ned to resolve with Roofr

- Which plan tier enables Zapier, and is it already enabled on the account?
- The full published trigger list (check the Zapier editor directly).
- Whether Roofr will confirm any non-public/partner API access.

**Sources**
- Roofr x Zapier Connection Guide — https://roofrhelp.zendesk.com/hc/en-us/articles/32274042534679-Roofr-x-Zapier-Connection-Guide
- Roofr X CompanyCam Connection Guide — https://roofrhelp.zendesk.com/hc/en-us/articles/31669062843031-Roofr-X-CompanyCam-Connection-Guide

---

## CompanyCam — the write path

| Item | Finding |
| --- | --- |
| Public REST API | **Yes.** |
| Base URL (legacy) | `https://api.companycam.com/v2` |
| Auth | OAuth 2.0 (plus legacy API tokens) |
| Plan gate | **Pro, Premium, or Elite only.** Not available on lower tiers. |
| Deprecation | `docs.companycam.com` is the **legacy API, deprecating early 2027**. |
| Recommended | Build against the newer API at `developers.companycam.com`. |

### Relevant endpoints (legacy v2, confirmed)

| Purpose | Endpoint |
| --- | --- |
| Create project | `POST /v2/projects` |
| Add photo to project | `POST /v2/projects/{project_id}/photos` |
| Upload document | `POST /v2/projects/{project_id}/documents` |

The photo endpoint accepts an optional `X-CompanyCam-User` header — "Email of
CompanyCam user to be designated as the creator" — which lets us attribute
uploads to the actual salesperson rather than a generic service account. Use it.

Photo tagging is supported (CompanyCam shipped "add tags when uploading a photo
to a project"), which is how our AI-assigned categories survive the handoff:
`Roof > Rear Slope > Possible Hail Impact` becomes CompanyCam tags the office can
filter on.

### What the Roofr sync gives us for free

Per CompanyCam's own integration page:

> "Any photos added to the CompanyCam Project will be available to add directly
> to your Roofr Proposals"

and

> "a Job in Roofr will create a Project in CompanyCam and vice versa."

So creating a CompanyCam project from our app creates the Roofr job. We never
need to write to Roofr directly.

### Risks

- **Plan dependency.** If Delta Ridge is not on CompanyCam Pro or above, this
  entire path is closed and handoff falls back to PDF + email. Confirm the plan
  before building against it.
- **Deprecation timing.** Building on the legacy v2 API buys a migration in
  roughly a year. Prefer the new API; `CompanyCamProvider` isolates the choice.
- **Double-entry risk.** Because the sync auto-creates records in both systems,
  a duplicated push creates a duplicate Roofr job. Handoff must be idempotent
  (see `external_records.payload_hash` in the data model).

**Sources**
- CompanyCam API welcome / plan gate — https://docs.companycam.com/docs/welcome
- Create Project — https://docs.companycam.com/reference/createproject
- Add Photo — https://docs.companycam.com/reference/createprojectphoto
- Upload a Document — https://docs.companycam.com/reference/createprojectdocument
- Photo tagging changelog — https://docs.companycam.com/changelog/add-tags-when-uploading-a-photo-to-a-project
- Roofr integration (CompanyCam side) — https://companycam.com/integrations/roofr
- Roofr integration announcement — https://roofr.com/blog/roofr-and-companycam-announce-integration-partnership

---

## HailTrace — thinner than expected

| Item | Finding |
| --- | --- |
| Public API docs | Exist, but minimal. |
| External API surface | **Essentially one endpoint:** order a hail history report (PDF) for a location. |
| Auth method | **Not specified** in the public documentation. |
| Storage/caching restrictions | **Not addressed** in the public documentation. |
| API pricing / required tier | **Not published.** Sales contact required. |
| Plans | Enterprise, Maps & Data, Maps Only, Free. None of the four publicly states API access. |

The rich surface often assumed for HailTrace — weather-event GeoJSON overlays,
programmatic hail/wind/tornado event search, per-property impact history — is
**not documented publicly**. It may well exist behind a paid tier or partner
agreement, but it cannot be designed against today.

Note also: because their public docs do **not** state storage restrictions, a
commonly-repeated claim that HailTrace forbids storing shape data is
**unverified**. It may still be true in the subscription agreement. Treat the
actual contract, not blog posts, as authoritative — and until Delta Ridge has
that contract in hand, assume geometry is render-only and do not persist it.

### Consequence for the build

HailTrace is an **optional provider behind `StormProvider`**, never a dependency.
Nothing in the app may fail to load because a HailTrace key is absent.

### The free alternative to ship with

NOAA / NWS Storm Prediction Center storm reports are public and free, and carry
hail size and wind reports with coordinates and timestamps. That is enough to:

- seed hail and wind events on the map,
- filter leads by storm date and hail size,
- prove the map's field value before spending on HailTrace.

`NoaaStormProvider` is the default (`VITE_STORM_PROVIDER=noaa`).
`HailTraceStormProvider` implements the same interface and is selected by env
once credentials exist.

### Action for Ned (sales call, not a dev task)

Ask HailTrace specifically: which tier exposes an API; whether per-property
impact history is programmatically available; and what the agreement says about
storing and caching returned geometry.

**Sources**
- Subscription Weather API — https://developers.hailtrace.com/api/open/
- External API — https://fa7c838b-developers.hailtrace.com/api/external/
- Plans and Pricing — https://hailtrace.com/plans

---

## Mapbox

Standard and well documented; no blockers. Used for GL JS rendering, Search Box
/ geocoding, Directions, and the Matrix API for travel-time ordering of route
stops (straight-line distance is misleading in a parish with rivers and limited
crossings — Baton Rouge especially).

Public `pk.*` tokens are client-safe and should be **URL-restricted** in the
Mapbox dashboard. Any secret `sk.*` token stays server-side.

**Source:** https://docs.mapbox.com/api/search/search-box/

---

## Supabase

Provides Postgres, Auth, Storage, Realtime, Edge Functions, and PostGIS in one
backend, which suits this application well. PostGIS carries lead and property
locations, territories, canvassing polygons, and proximity queries.

**Current access gap (2026-09-18):** the intended project
`udrxvpkihkbrudvwggpr` is **not reachable** from the connected Supabase
credentials in use. Only two projects are visible, both in the
`Divorce_Ledger_AI` organization:

- `ntkegkbhvgltdcfoakyk` (Divorce_Ledger_AI)
- `cscowglyrgxqxwcnftzt` (PlainSpeakAI)

Resolve by either reconnecting the Supabase connector to the account that owns
`udrxvpkihkbrudvwggpr`, or supplying its URL and anon key as env config.
Migrations in `supabase/migrations/` are written to apply cleanly either way.

**Source:** https://supabase.com/docs/guides/database/overview

---

## AI provider

Abstracted behind `AIProvider` so no model is hardcoded into business logic.
Used for photo classification, image quality detection, voice-transcript
structuring, inspection summarization, and handoff narrative generation.

All AI output that touches a record is Zod-validated structured JSON. Every run
is persisted to `ai_runs` with provider, model, prompt version, latency, and any
human correction — which over time becomes the evaluation set for measuring
whether the AI is actually helping.

`VITE_AI_PROVIDER=none` is a fully supported state: the app works, AI assist is
simply absent.

---

## Summary of external dependencies

| Dependency | Needed for | Blocking? | Status |
| --- | --- | --- | --- |
| Supabase project access | Everything persistent | **Yes** | Access gap — see above |
| Mapbox public token | Map, search, routing | For map features only | Needed |
| CompanyCam Pro+ | API handoff into Roofr | No — falls back to PDF/email | Plan unconfirmed |
| Roofr Zapier | Inbound status events | No | Tier unconfirmed |
| HailTrace API | Premium storm data | No — NOAA is the default | Sales conversation |
| AI provider key | AI assist features | No — degrades gracefully | Needed |

Nothing except Supabase access blocks development. That is deliberate: every
integration sits behind a provider interface with an explicit unavailable state.
