# Deployment

**Target:** https://deltaridge.bridgebox.ai
**Vercel project:** `deltaridge` (`prj_wUaznrMlrHN3JOw7cIbDZcbYerDy`)
**Team:** `pearsonprojects` (`team_HQxssrWtf0ZN98RlOhjmnvKi`)

## Status as of 2026-09-18

| Step | State |
| --- | --- |
| App built, typechecked, linted, tested, smoke-tested | Done |
| Vercel project created with env vars | Done |
| Domain attached to project, verified by Vercel | Done |
| Repo linked (`.vercel/project.json`) | Done |
| **Vercel CLI authentication** | **Needed from Ned** |
| First production deploy | Blocked on the above |
| **Cloudflare CNAME** | **Needed from Ned** |

## Deploying

The repo is pre-linked, so once authenticated this is one command:

```bash
cd C:\dev\github\business\DeltaRidge
npx vercel login      # one time, opens a browser
npx vercel deploy --prod
```

`.vercelignore` keeps `_to_delete/`, `node_modules`, `tests`, `docs` and
`supabase` out of the upload. Without it every deploy would ship the ~300MB
corrupted `node_modules` sitting in `_to_delete/`.

### Why not the Vercel API directly

It was tried and abandoned. The source is ~110KB across 27 files, and inlining
all of it into a single API call proved unreliable — two deployments went up
with incomplete file sets and were cancelled. The CLI reads from disk, so it
cannot half-send. Use the CLI.

## DNS

`bridgebox.ai` runs on Cloudflare nameservers (`bailey`/`jasper.ns.cloudflare.com`),
so Vercel cannot create the record itself. Add this in the Cloudflare dashboard,
under bridgebox.ai > DNS > Records:

| Field | Value |
| --- | --- |
| Type | CNAME |
| Name | `deltaridge` |
| Target | `cname.vercel-dns.com` |
| Proxy status | **DNS only** (grey cloud) |
| TTL | Auto |

Proxying (orange cloud) must stay **off**. Cloudflare's proxy sits in front of
Vercel's edge and breaks its automatic TLS certificate issuance.

This is the same pattern already working in that zone for
`documentation.bridgebox.ai`, which is a Vercel site using exactly this record.

## Environment variables (set on the Vercel project)

| Key | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://udrxvpkihkbrudvwggpr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | publishable key (browser-safe, RLS-protected) |
| `VITE_STORM_PROVIDER` | `noaa` |
| `VITE_HANDOFF_MODE` | `pdf_email` |
| `VITE_AI_PROVIDER` | `none` |

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `COMPANYCAM_API_TOKEN`, `HAILTRACE_API_KEY`,
`AI_API_KEY`) are deliberately **not** set here. They belong in Supabase Edge
Function secrets, never in a browser bundle. `src/lib/env.ts` refuses to boot if
any of them appears with a `VITE_` prefix.

## Access

Vercel Auth is enabled for `*.vercel.app` URLs but disabled for custom domains,
so `deltaridge.bridgebox.ai` will be publicly reachable while preview URLs stay
private to the team.
