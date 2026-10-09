import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'

/**
 * One plain-language list of what the app can do today, and what is not
 * switched on yet. The Settings → Integrations health tab keeps the detailed
 * telemetry; this answers the simpler question a rep or owner actually asks:
 * "what's live, and what do I still need to set up?"
 */

export type CapabilityState = 'live' | 'partial' | 'not_connected' | 'error' | 'off' | 'checking' | 'unknown'
export type CapabilityGroup = 'Finding leads' | 'In the field' | 'Office & follow-up' | 'Marketing'

export interface Capability {
  readonly id: string
  readonly name: string
  readonly group: CapabilityGroup
  readonly does: string
  readonly state: CapabilityState
  readonly detail: string
  /** Where to use it when live, or where to switch it on when not. */
  readonly to: string
}

interface Probe {
  signedIn: boolean
  configured: { contacts: boolean; push: boolean; roofr: boolean } | null
  runs: Array<{ integration: string; status: string; created_at: string }>
  requestsTable: boolean | null
  socialAccounts: number | null
}

const env = import.meta.env as Record<string, string | undefined>

export function buildCapabilities(p: Probe | null): Capability[] {
  const caps = buildRaw(p)
  if (p && !p.signedIn) {
    // Without a session the server cannot be asked; say so instead of guessing.
    return caps.map((c) => (SERVER_CHECKED.has(c.id) ? { ...c, state: 'unknown' as const, detail: 'Sign in to check this.' } : c))
  }
  return caps
}

const SERVER_CHECKED = new Set(['storm-check', 'imagery', 'push', 'roofr', 'contacts', 'social'])

function buildRaw(p: Probe | null): Capability[] {
  const checking = p === null
  const flag = (v: boolean | null | undefined, on: CapabilityState = 'live'): CapabilityState =>
    checking || v === null || v === undefined ? 'checking' : v ? on : 'not_connected'
  const stormProvider = env.VITE_STORM_PROVIDER ?? 'noaa'
  const radar = env.VITE_RADAR_HAIL ?? 'swdi'
  const ai = env.VITE_AI_PROVIDER ?? 'none'
  const lastRun = (name: string) => p?.runs.find((r) => r.integration === name)

  const eagle = lastRun('eagleview')
  const eagleState: CapabilityState = checking ? 'checking' : !eagle ? 'not_connected' : eagle.status === 'success' ? 'live' : 'error'

  return [
    { id: 'storm-check', group: 'Finding leads', name: 'Storm check page', to: '/free-roof-check',
      does: 'Homeowners check their address for hail and request an inspection. Requests land on Today, hottest first.',
      state: flag(p?.requestsTable), detail: p?.requestsTable === false ? 'Request table not installed on this database.' : 'Share the link on mailers, ads, yard signs and your website.' },
    { id: 'radar', group: 'Finding leads', name: 'Radar hail (NOAA)', to: '/leads',
      does: 'Estimated hail size near every address, two years back. Free, no key.',
      state: radar === 'off' ? 'off' : 'live', detail: radar === 'off' ? 'Turned off by VITE_RADAR_HAIL.' : 'Radar estimates are shown separately from ground reports.' },
    { id: 'reports', group: 'Finding leads', name: 'Ground hail reports (NOAA/NWS)', to: '/leads',
      does: 'Official spotter and public hail reports by date.',
      state: stormProvider === 'none' ? 'off' : 'live', detail: 'Public NWS data.' },
    { id: 'hailtrace', group: 'Finding leads', name: 'HailTrace swaths', to: '/settings?tab=storms',
      does: 'Paid, meteorologist-drawn hail swaths.',
      state: stormProvider === 'hailtrace' ? 'live' : 'not_connected', detail: 'Optional paid upgrade. Free NOAA data works without it.' },
    { id: 'property', group: 'Finding leads', name: 'Owner, roof age & permits', to: '/leads',
      does: 'Owner name, homestead, last re-roof permit for each door.',
      state: 'partial', detail: 'East Baton Rouge only. Other parishes publish no permit feed; use the Local tab on a property for their assessor.' },
    { id: 'mailer', group: 'Finding leads', name: 'Storm mailer list', to: '/',
      does: 'CSV of 12+ year roofs with a tracked QR code per house.',
      state: 'live', detail: 'Export from Today (managers). Automatic printing via Lob is not set up.' },

    { id: 'routes', group: 'In the field', name: 'Routes & GPS', to: '/mission',
      does: 'Start a route, log doors, works with no signal.', state: 'live', detail: 'Tracks only during a route you start.' },
    { id: 'inspection', group: 'In the field', name: 'Inspections & photos', to: '/new',
      does: 'Checklist, photos, voice notes, works offline.', state: 'live', detail: 'Syncs when you have signal.' },
    { id: 'imagery', group: 'In the field', name: 'Aerial roof imagery (EagleView)', to: '/settings?tab=integrations',
      does: 'Overhead photos of the roof before you arrive.',
      state: eagleState, detail: eagleState === 'error' ? 'Last request failed — check Settings → Integrations.' : eagleState === 'live' ? 'Working.' : 'Needs EagleView credentials on the server.' },
    { id: 'local', group: 'In the field', name: 'Local permit & code links', to: '/leads',
      does: 'Permit office, assessor, parcel map, flood zone and code for 10 parishes.', state: 'live', detail: 'Open any property → Local.' },
    { id: 'estimate', group: 'In the field', name: 'Estimator', to: '/estimate',
      does: 'Builds a price from your cost book.', state: 'partial', detail: 'Needs your real material and labour costs in the cost book.' },

    { id: 'push', group: 'Office & follow-up', name: 'Phone alerts', to: '/settings?tab=notifications',
      does: 'Push a new hot request to reps’ phones.', state: flag(p?.configured?.push), detail: p?.configured?.push ? 'Each rep turns alerts on in Settings → Notifications.' : 'Needs VAPID keys on the server.' },
    { id: 'roofr', group: 'Office & follow-up', name: 'Roofr hand-off', to: '/settings?tab=integrations',
      does: 'Send sold jobs to Roofr through Zapier.', state: flag(p?.configured?.roofr), detail: p?.configured?.roofr ? 'Working when a Zap is active.' : 'Needs the Zapier hook URL on the server.' },
    { id: 'contacts', group: 'Office & follow-up', name: 'Contact lookup provider', to: '/settings?tab=contacts',
      does: 'Find a homeowner’s phone or email.', state: flag(p?.configured?.contacts), detail: 'Looked-up numbers cannot be called or texted until the homeowner confirms them.' },
    { id: 'ai', group: 'Office & follow-up', name: 'AI assistant', to: '/settings?tab=ai',
      does: 'Summaries and suggested next steps.', state: ai === 'none' ? 'off' : 'live', detail: ai === 'none' ? 'No AI provider configured. Everything else works without it.' : `Provider: ${ai}.` },

    { id: 'social', group: 'Marketing', name: 'Social inbox & publishing', to: '/inbox',
      does: 'Facebook/Instagram messages and posts in one place.',
      state: checking ? 'checking' : (p?.socialAccounts ?? 0) > 0 ? 'live' : 'not_connected', detail: (p?.socialAccounts ?? 0) > 0 ? `${p?.socialAccounts} account(s) connected.` : 'No social accounts connected.' },
  ]
}

export function summarize(caps: readonly Capability[]): { live: number; setup: number; problems: number } {
  return {
    live: caps.filter((c) => c.state === 'live' || c.state === 'partial').length,
    setup: caps.filter((c) => c.state === 'not_connected' || c.state === 'off').length,
    problems: caps.filter((c) => c.state === 'error').length,
  }
}

export function useCapabilities() {
  const { membership } = useSession()
  const orgId = membership?.organizationId ?? null
  const [probe, setProbe] = useState<Probe | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const supabase = getSupabase()
      const result: Probe = { signedIn: Boolean(supabase && orgId), configured: null, runs: [], requestsTable: null, socialAccounts: null }
      if (supabase && orgId) {
        const [status, requests, social] = await Promise.allSettled([
          supabase.functions.invoke('integration-status', { body: { organizationId: orgId } }),
          supabase.from('inspection_requests').select('id', { count: 'exact', head: true }),
          supabase.from('social_accounts').select('id', { count: 'exact', head: true }),
        ])
        if (status.status === 'fulfilled' && !status.value.error) {
          const d = status.value.data as { configured?: Probe['configured']; runs?: Probe['runs'] }
          result.configured = d.configured ?? null
          result.runs = d.runs ?? []
        } else {
          result.configured = { contacts: false, push: false, roofr: false }
        }
        result.requestsTable = requests.status === 'fulfilled' ? !requests.value.error : false
        result.socialAccounts = social.status === 'fulfilled' && !social.value.error ? social.value.count ?? 0 : 0
      }
      if (!cancelled) setProbe(result)
    }
    void run()
    return () => { cancelled = true }
  }, [orgId])

  return buildCapabilities(probe)
}
