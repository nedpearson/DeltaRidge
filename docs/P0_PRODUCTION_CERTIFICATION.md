# P0 Production Certification — Sync, Offline Durability, Golden Lead

## Status

The repository now contains substantial sync infrastructure beyond the older implementation-status note:

- push + pull sync paths;
- ownership-bound outbox items;
- auth blocking/unblocking;
- retry/backoff;
- remote-ID scoping;
- route-point batching;
- server read views;
- diagnostics/server snapshots;
- trace/correlation support;
- Roofr event/push handlers;
- unit coverage for outbox ownership/retry, route batching, tracing, Roofr and related flows.

That is encouraging, but **code presence is not certification**. P0 closes only after the production round trip is proven on real devices/accounts.

---

## Certification target

A rep must be able to:

1. sign in;
2. download/open today's leads;
3. go offline;
4. start a route;
5. create/modify a lead;
6. log five door events;
7. record GPS fixes;
8. add one typed note;
9. record one voice note;
10. attach one photo;
11. change lead status;
12. kill the app;
13. reopen the app offline;
14. verify every item still exists;
15. sign out with unsynced work;
16. sign back in as the same user;
17. restore connectivity;
18. allow the queue to drain;
19. end the route.

A manager on a separate authenticated device must then see:

- the same lead exactly once;
- all five activities exactly once;
- the route session;
- the actual GPS trail;
- the photo;
- the voice-note record;
- the latest lead status;
- timestamps/rep attribution;
- no duplicate rows;
- zero silently lost queue items.

---

## Required failure tests

### Network

- offline from route start;
- connection drops mid-upload;
- request times out after server commit but before client receives acknowledgement;
- reconnect with hundreds of GPS points queued.

### Authentication

- access token expires while queue exists;
- sign out with pending work;
- sign in as a different user: foreign work must not sync under that account;
- sign back in as original user: queue resumes.

### App lifecycle

- browser/app killed with pending work;
- device/browser restarted;
- PWA update arrives while work is pending;
- deep-link reload while offline.

### Server/provider

- Supabase 500/transient failure;
- duplicate mutation replay;
- attachment failure after lead/activity succeeds;
- route-point batch contains one bad point;
- Roofr/Zapier/provider unavailable where applicable.

---

## Hard assertions

Certification fails if any of these occur:

- local field work disappears;
- a retry creates a duplicate logical record;
- one user's queued work syncs under another user;
- the UI says `Synced` before server acknowledgement;
- missing server data is interpreted as zero/none;
- route GPS gaps are interpolated and shown as actual travel;
- a photo/audio failure removes the parent activity;
- a manager cannot independently read the server-backed record.

---

## Golden Lead

Create one permanent synthetic test record reserved for deployment smoke testing.

It should exercise:

- lead creation;
- property link;
- contact info;
- route;
- knock;
- GPS verification;
- typed note;
- voice note;
- photo;
- status transition;
- pull to second device;
- Roofr/integration path when configured.

Every production deployment should leave an auditable test result:

- build/commit SHA;
- test timestamp;
- environment;
- rep test account;
- manager test account;
- queued item count before/after;
- server row counts before/after;
- duplicate count;
- failures;
- final PASS/FAIL.

---

## Automated checks to keep green

Run at minimum:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Also run the live smoke test separately because unit tests do not certify production connectivity:

```bash
npx vitest run tests/live/engine.smoke.test.ts
```

Do not treat the live smoke test as a substitute for the two-device round trip above.

---

## Diagnostics requirements

The diagnostics/health UI must expose:

- signed-in user;
- organization;
- device ID;
- online/offline;
- pending queue count;
- auth-blocked count;
- foreign-user queue count;
- stalled/dead-letter count;
- last successful drain;
- last successful pull;
- server lead count;
- server activity count;
- last integration success;
- latest error;
- retry control.

No raw secret values or unnecessary PII in diagnostics.

---

## Exit criteria

P0 is DONE only when:

1. automated checks pass;
2. production migrations/views required by current sync code exist;
3. the full offline/auth/app-kill scenario passes;
4. the same data is independently visible on a manager device;
5. duplicate replay is proven idempotent;
6. all failed work is visible/retryable;
7. the result is documented with commit SHA and evidence.

Until then, later business features can continue in design, but should not be called production-ready.
