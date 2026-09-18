# Implementation Status

**Last updated:** 2026-09-18

"Complete" here means built, executed, and verified by a command whose output was
read. UI existing is not complete. Code compiling is not complete.

**Live:** https://deltaridge.bridgebox.ai

---

## COMPLETE

### Repository and toolchain
React 19 + TypeScript (strict, with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`) + Vite 6 + Tailwind 4 + PWA via `vite-plugin-pwa`.
ESLint 9 flat config, Vitest. **Verified:** production build on Vercel runs
`tsc -b && vite build` clean; 72 modules, 370KB JS (113KB gzip).

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
losing genuine storm reports. Ids now fingerprint the report remark.

### Environment configuration
`src/lib/env.ts` validates configuration with Zod at startup and **refuses to
boot** if a server-only secret has been given a `VITE_` prefix. `src/lib/backend.ts`
wraps it tolerantly so a misconfigured backend degrades to "working offline"
instead of a white screen on a roof.

### Inspection completeness engine
`src/features/inspections/completeness.ts` — pure and dependency-free, so it runs
offline, which is when it matters. Separates blockers (cannot send) from warnings
(office will call you) from advisories. Detects conditions mentioned in notes with
no supporting photo, damage close-ups with no slope overview, photos flagged for
retake, and unconfirmed AI findings. **Verified:** 21 unit tests.

### Offline-first local store
`src/lib/db.ts` — IndexedDB (via `idb`) holding inspections, photos, observations
and voice notes, each with a client-generated UUID and a `syncState`, plus an
`outbox` queue recording what still needs pushing. Everything a rep captures is
safe the moment it lands here. `AppShell` surfaces the pending count.

### Field capture flow
`CapturePanel` (guided photo capture by category, on-device resize/thumbnailing in
`src/lib/image.ts`), `NotesPanel` (typed observations with severity, plus voice
notes recorded and stored locally), `ReviewPanel` (completeness review and the
gap-filling fields), wired through `src/pages/`.

### Deployment
Vercel project `deltaridge` in team `pearsonprojects`, custom domain
`deltaridge.bridgebox.ai` on a Cloudflare DNS-only CNAME to `cname.vercel-dns.com`.
**Verified:** HTTP 200 with a valid certificate, app boots and renders in a real
browser. See `docs/DEPLOYMENT.md`.

---

## NOT STARTED

Phase order reflects the agreed inversion: ship one vertical slice a rep can use,
then widen.

| Area | Note |
| --- | --- |
| Outbox drain / Supabase sync worker | The queue records; nothing pushes yet. Next. |
| Supabase auth + RLS session wiring | Client configured, no sign-in flow |
| Voice transcript structuring | Audio is captured and stored; nothing transcribes it |
| AI provider implementations | Interface shape settled by the schema; adapters unwritten |
| Map, pins, filters, PostGIS queries | Needs a Mapbox token |
| Office handoff PDF generation | |
| CompanyCam push + sync worker | Needs plan confirmation (Pro/Premium/Elite) |
| Roofr inbound webhook | |
| Dashboards, routing, scoring | Deliberately last — scoring needs outcome data first |

---

## Decisions worth not relitigating

1. **CompanyCam is the write path into Roofr, not Zapier.** Roofr's Zapier
   integration is explicitly one-way outbound. Verified in their docs.
2. **HailTrace is optional, NOAA is the default.** HailTrace's public API is one
   endpoint and its API tier is unpublished. NOAA is free and returns real usable
   data for Delta Ridge's parishes today.
3. **AI suggestions and human judgement live in separate columns.** The rep's
   value always wins, unconfirmed AI findings cannot reach an office document
   unflagged, and `photo_ai_analysis.human_action` accumulates the evidence for
   whether AI assist is worth its cost.
4. **Opportunity scoring is deferred.** A score built with no closed-won history
   is an invented number wearing a confidence display. Revisit after ~50 outcomes.
5. **Licensed geometry is blocked in the database, not in a code comment.**
6. **`exactOptionalPropertyTypes` is kept on.** Fields a rep can clear are typed
   `?: T | undefined` rather than loosening the compiler flag.
