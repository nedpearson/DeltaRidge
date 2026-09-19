# Implementation Status

**Last updated:** 2026-09-18 (Phase 1: field core)

"Complete" here means built, executed, and verified by a command whose output was
read. UI existing is not complete. Code compiling is not complete.

**Live:** https://deltaridge.bridgebox.ai

---

## COMPLETE

### Repository and toolchain
React 19 + TypeScript (strict, with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`) + Vite 6 + Tailwind 4 + PWA via `vite-plugin-pwa`.
ESLint 9 flat config, Vitest. **Verified:** `npm run typecheck`, `npm run lint`,
`npm test` (60 tests) and `npm run build` all clean; bundle 616KB JS
(177KB gzip). The 370KB figure previously recorded here predated Mapbox being
pulled into the graph and was stale, not a regression.

### Brand tokens
Extracted from the real logo at delta-ridge.com rather than invented: steel navy
`#1D5F80` and warm gold `#B0A070`, with Oswald (display) and Poppins (UI) per the
live site. Full scales and lead-status colors in `src/index.css`. Dark-first,
because reps read screens in glare. All touch targets floored at 44px.

### Database schema — 10 migrations
`supabase/migrations/`, covering organizations and RBAC, customers/properties/
leads/activities/appointments, inspections with observations and checklists,
photos with separated AI analysis, voice notes, storm intelligence, office
handoffs, integration sync, AI run tracking, and an append-only audit log.
PostGIS throughout; UUID keys so records can be created offline.

**Verified 2026-09-18 against PostgreSQL 16.13 + PostGIS 3:** all ten
migrations replay cleanly on an empty database, `supabase/apply_all.sql` applies
in one shot (31 public tables), and **all 15 assertions pass** — including cases
10-12, which had never actually been executed before (see the open item that
used to be here), and the new 13-15 covering idempotent field sync.

Two portability bugs were found by running them for the first time:
migration 0007 seeded the owner invite against an organisation row that exists
only in production, so the file could not be replayed anywhere else; and the
test fixtures assumed that same row. Both are fixed, so the suite now runs on
any machine with Postgres and PostGIS.

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

### Offline-to-Supabase sync — the field core
The outbox drains. `src/lib/sync/` resolves a flat local inspection into the
customer, property and inspection rows the schema expects, then pushes photos,
observations, voice notes and the office package.

Everything is an **upsert on (organization_id, client_id)**, added by migration
0010. That is not a refinement — it fixes two defects that made the core loop
unreliable:

1. **Edits never reached the server.** `ensureInspection` returned early
   whenever it already had a remote id, so an inspection was pushed once, at
   creation, and the completion time, the rep's recommendation, the homeowner's
   stated roof age and the override note stayed on the phone forever. The
   office saw a permanently in-progress shell. It now pushes current state on
   every drain, memoised once per drain so forty photos do not cause forty
   upserts.
2. **A lost acknowledgement wedged the queue.** Photos and voice notes already
   had a unique `client_id`, and the code used `.insert()`, so a retry after the
   row had been written but the response lost failed with 23505 — permanently,
   with the item retried every 30 seconds for the rest of the day. Inspections
   and observations had no `client_id` at all and simply duplicated.

Retries now back off (5s doubling to a 5-minute ceiling, ~5 minutes of real
attempts before giving up), and an item that gives up is **shown to the rep**
with its error and a Try again button rather than disappearing into a silent
loop. Being offline is not a failed attempt: the drain skips without touching
attempt counts.

### Office handoff
`src/features/handoff/package.ts` builds the frozen package the office receives
— customer, property, homeowner statements kept in their own namespace,
observations with their provenance (`inspector` / `voice` / `ai`) and
confirmation state intact, every photo with its category and quality flag, voice
notes with a transcript slot, and the validation result recording what was
missing and what the rep waived. `packageFingerprint` is stable across rebuilds
and ignores `generatedAt`, so re-sending unchanged work is a detectable no-op.

Send to office writes an `office_handoffs` row with status **`ready`**, not
`sent`. Nothing emails anyone and nothing calls CompanyCam yet; marking a row
sent would be a claim the office would act on. `ready` is the truth: the package
is complete, validated, and visible to the office in Supabase.

### Lead generation — the door list
`/leads`. Hail reports crossed with parish permit records, producing a ranked,
explainable door list. It runs **entirely in the browser**: the NWS storm feed,
the East Baton Rouge permit feed and the parish address locator are all public,
keyless and CORS-open, so this needed no backend, no API key and no Supabase —
which is why it could ship while the live database is still unreachable.

The join no competitor ships:

```
hail reports  ×  roof age from permit history  −  roofs already replaced
```

Three things were learned the hard way and are now encoded:

1. **The parish only began putting coordinates on permits around 2016.**
   Filtering permits to "built before 2015" — which is how you find a roof old
   enough to sell — leaves **13** usable records out of **2,327**. The fix is
   `src/integrations/geocode/ebr.ts`, which geocodes the rest through the
   parish's own locator and caches every result permanently. Verified live:
   13 candidates became **590**.
2. **The batch geocoder only works over POST.** A hundred addresses in a query
   string exceeds the server's URL limit and returns 404 — which reads as "no
   such endpoint" rather than "request too long".
3. **Re-roof permits only exist from 2025 onward**, which matches Act 239
   making them mandatory that August. So suppression covers storms from 2025
   on and is blind before that. Stated in the UI rather than implied.

Scoring is deterministic and explainable — hail size, recency, distance, roof
age, with hand-set weights — and every lead carries the plain-English reasons it
ranked where it did. It is **not** a model and the UI never calls it a
probability: there is still no closed-won history to learn one from. The inputs
are stored on each lead so the weights can be fitted once there is.

Also included: re-roof permits grouped by contractor, which is a free and
current picture of who is winning which subdivision.

Honest limits, all surfaced in the app: East Baton Rouge only (Ascension has
required re-roof permits since August 2025 but publishes no feed; Livingston is
view-only), the permit history starts in 2011 so roofs older than ~15 years are
invisible, and a roof replaced without a permit leaves no trace.

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
| Office handoff PDF | The package exists as structured jsonb; nothing renders it to PDF yet |
| Office review screen | The office can read the row; there is no UI built for them |
| Voice transcript structuring | Audio is captured, stored and uploaded; nothing transcribes it |
| AI provider implementations | Interface shape settled by the schema; adapters unwritten |
| Map, pins, filters, PostGIS queries | Needs a Mapbox token |
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

---

## Update — end of 2026-09-18

**Live at https://deltaridge.bridgebox.ai**

- Vercel project, domain attached, Cloudflare CNAME (DNS only), production
  deploy verified end to end.
- **Offline fixed.** The first live build failed an offline reload — workbox had
  no `navigateFallback`, so a navigation with no signal fell through to a dead
  network. Fixed and verified in production: the service worker controls the
  page, offline reload renders, offline deep links render.
- **Schema applied.** All 27 tables live on Supabase project
  `udrxvpkihkbrudvwggpr`. Verified through the REST API rather than by trusting
  the editor: every table returns `[]` to an anonymous key, and an anonymous
  insert is refused with `42501 row-level security policy`. RLS is enforcing,
  not merely declared.
- **Dependencies installed** — 633 packages, targeted at Windows with
  `--os=win32 --cpu=x64`, so the tree carries `@esbuild/win32-x64` and the win32
  rollup binaries rather than the Linux ones the installing shell would have
  fetched by default. `package-lock.json` is committed.
- **`.env` no longer ships to Vercel.**

### Resolved

The repository now has commits and the Railway "could not find latest commit"
error is gone with it.

### On Railway

Delta Ridge is a static Vite SPA and is already served from Vercel's edge on the
production domain. Railway bills for a container running continuously, so
deploying this app there buys a slower, costlier second copy and a second deploy
path to maintain. Railway earns its place on the parts that do not exist yet —
the CompanyCam sync worker, the Roofr webhook receiver, the AI photo-analysis
endpoint — which are long-running server work that does not belong on an edge
CDN.
