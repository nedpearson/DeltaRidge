# Implementation Status

**Last updated:** 2026-09-18

"Complete" here means built, executed, and verified by a command whose output was
read. UI existing is not complete. Code compiling is not complete.

---

## COMPLETE

### Repository and toolchain
React 19 + TypeScript (strict, with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`) + Vite 6 + Tailwind 4 + PWA via `vite-plugin-pwa`.
ESLint 9 flat config, Vitest. Module structure per the agreed layout.
**Verified:** `tsc --noEmit` clean, `eslint .` clean, `vitest run` 21/21 passing.

### Brand tokens
Extracted from the real logo at delta-ridge.com rather than invented: steel navy
`#1D5F80` and warm gold `#B0A070`, with Oswald (display) and Poppins (UI) per the
live site. Full scales and lead-status colors in `src/index.css`. Dark-first,
because reps read screens in glare. All touch targets floored at 44px.

### Database schema — 6 migrations, 1,125 lines
`supabase/migrations/`, covering organizations and RBAC, customers/properties/
leads/activities/appointments, inspections with observations and checklists,
photos with separated AI analysis, voice notes, storm intelligence, office
handoffs, integration sync, AI run tracking, and an append-only audit log.
PostGIS throughout; UUID keys so records can be created offline.

**Verified:** all six migrations execute cleanly against PostgreSQL 16.15 +
PostGIS 3, and 9 assertions on the guarantees pass. See `supabase/tests/`.

### Storm provider layer
`StormProvider` interface with three implementations: NOAA (default),
HailTrace (deliberately unimplemented, reports itself unavailable with an
actionable reason), and disabled.

**Verified live against the real NOAA/IEM service:** 59 storm events returned for
Delta Ridge's actual service area, 1,610 events Louisiana-wide for 2026 with all
ids unique and stable across calls, 158 hail reports all carrying sizes, 32
Louisiana hail reports at or above 1.75".

A real bug was caught by that live test and fixed: NWS `product_id` values are
per-*bulletin*, not per-report, so the first id scheme produced collisions that
would have been silently swallowed by the database's uniqueness constraint,
losing genuine storm reports. Ids now fingerprint the report remark as well.

### Environment configuration
`src/lib/env.ts` validates configuration with Zod at startup and **refuses to
boot** if a server-only secret has been given a `VITE_` prefix, which is the
cheap guard against shipping a service-role key to every phone in the field.
Every integration credential is optional by design.

### Inspection completeness engine
`src/features/inspections/completeness.ts` — the feature most likely to pay for
this project. Pure, dependency-free, so it runs offline, which is when it matters.
Separates blockers (cannot send) from warnings (office will call you) from
advisories. Detects conditions mentioned in notes with no supporting photo,
damage close-ups with no slope overview, photos flagged for retake, and
unconfirmed AI findings.

**Verified:** 21 unit tests, including the composite four-gap scenario from the
original brief.

---

## NOT STARTED

Phase order below reflects the agreed inversion: ship one vertical slice a rep can
use, then widen. It does not follow the original ten-phase plan.

| Area | Note |
| --- | --- |
| Supabase client + auth wiring | Blocked on project access (see BLOCKED) |
| Offline write queue (IndexedDB) | Interface designed, not built |
| Camera capture flow | The core field UX |
| Voice capture + transcript structuring | |
| AI provider implementations | Interface shape settled by the schema; adapters unwritten |
| Map, pins, filters, PostGIS queries | Needs a Mapbox token |
| Office handoff PDF generation | |
| CompanyCam push + sync worker | Needs plan confirmation |
| Roofr inbound webhook | |
| Dashboards, routing, scoring | Deliberately last — scoring needs outcome data first |

---

## BLOCKED

**Supabase project access.** The intended project `udrxvpkihkbrudvwggpr` is not
reachable from the connected credentials; only `ntkegkbhvgltdcfoakyk` and
`cscowglyrgxqxwcnftzt` (both in the `Divorce_Ledger_AI` org) are visible.
Migrations are written and proven against local Postgres, so this unblocks with
either a reconnected connector or the project URL and anon key.

**Dependencies are not installed in the working copy.** `npm install` is
pathologically slow over the remote filesystem bridge and left a corrupted
`node_modules`, which has been moved to `_to_delete/` (deletion was not
permitted from this session). Everything was instead installed and verified in a
clean environment. Run `npm install` once natively and the repo is live.

---

## Decisions worth not relitigating

1. **CompanyCam is the write path into Roofr, not Zapier.** Roofr's Zapier
   integration is explicitly one-way outbound. Verified in their docs.
2. **HailTrace is optional, NOAA is the default.** HailTrace's public API is one
   endpoint and its API tier is unpublished. NOAA is free and, as proven above,
   returns real usable data for Delta Ridge's parishes today.
3. **AI suggestions and human judgement live in separate columns.** The rep's
   value always wins, unconfirmed AI findings cannot reach an office document
   unflagged, and `photo_ai_analysis.human_action` accumulates the evidence for
   whether AI assist is worth its cost.
4. **Opportunity scoring is deferred.** A score built with no closed-won history
   is an invented number wearing a confidence display. Revisit after ~50 outcomes.
5. **Licensed geometry is blocked in the database, not in a code comment.**
