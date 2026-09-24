import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  ENGINE_VERSION,
  runLeadEngine,
  type LeadRunSettings,
} from '@/features/leads/engine'

/**
 * The dates the engine actually asks upstream for.
 *
 * "2026 is missing" was the complaint, and a window that resolves correctly in
 * a unit test but is not the window handed to NOAA proves nothing. So these
 * assert the query string on the wire, not just the resolved object.
 */

const NOW = new Date('2026-09-20T15:30:00.000Z')

interface Capture {
  readonly urls: string[]
  readonly fetchImpl: typeof fetch
}

function capturingFetch(): Capture {
  const urls: string[] = []
  const fetchImpl = ((input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.toString() : String(input)
    urls.push(url)
    // SWDI answers in CSV, not JSON, and its "no hail" answer is a summary
    // block rather than an empty list. Handing it JSON here would make the
    // radar source look broken in every test that does not care about radar.
    if (url.includes('swdiws')) {
      return Promise.resolve(
        new Response('summary\ncount,0\ntotalTimeInSeconds,0.0', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      )
    }
    const body = url.includes('lsr.py') ? { type: 'FeatureCollection', features: [] } : []
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as typeof fetch
  return { urls, fetchImpl }
}

function settings(overrides: Partial<LeadRunSettings>): LeadRunSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

function stormUrl(urls: string[]): URL {
  const hit = urls.find((u) => u.includes('lsr.py'))
  expect(hit, 'the engine never called the storm feed').toBeDefined()
  return new URL(hit as string)
}

describe('lead engine storm window', () => {
  it('asks NOAA for January 1 of the current year when the window is THIS YEAR', async () => {
    const { urls, fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.window.key).toBe('this_year')
    expect(run.window.label).toBe('2026 storms')
    expect(new Date(run.window.from).getUTCFullYear()).toBe(2026)
    expect(run.window.to).toBe(NOW.toISOString())

    const sts = stormUrl(urls).searchParams.get('sts') ?? ''
    expect(sts).toBe(run.window.from)
    expect(new Date(sts).getUTCFullYear()).toBe(2026)
    // Jan 1 local in Louisiana is still 2026 in UTC, but never later than Jan 2.
    expect(new Date(sts).getUTCMonth()).toBe(0)
    expect(new Date(sts).getUTCDate()).toBeLessThanOrEqual(2)
  })

  it('still honours the legacy 24-month window', async () => {
    const { urls, fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'last_24_months' }), {
      fetchImpl,
      now: NOW,
    })

    expect(run.window.from.slice(0, 7)).toBe('2024-09')
    expect(stormUrl(urls).searchParams.get('sts')).toBe(run.window.from)
  })

  it('reports an empty window as an empty window, not as a broken feed', async () => {
    const { fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.coverage.official.kind).toBe('live')
    expect(run.coverage.radar.kind).toBe('live')
    expect(run.coverage.totalEvents).toBe(0)
    expect(run.notes.join(' ')).toContain('No qualifying hail')
  })

  /**
   * Radar used to be the named gap. It now runs — but the thing that test was
   * really protecting is unchanged and still worth a test: the two sources are
   * counted separately, never summed into one figure that reads as
   * completeness.
   */
  it('counts radar separately from the official ground reports', async () => {
    const { urls, fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.coverage.official.kind).toBe('live')
    expect(run.coverage.radar.kind).toBe('live')
    if (run.coverage.radar.kind === 'live') {
      expect(run.coverage.radar.note).toContain('NEXRAD')
      // The floor is part of the claim: the same count at 1.0" means something
      // else, because MEHS over-predicts.
      expect(run.coverage.radar.note).toContain(`${DEFAULT_SETTINGS.radarMinHailInches}"`)
    }

    // And it asked the radar service for the same window it asked NOAA for.
    const radarCalls = urls.filter((u) => u.includes('swdiws'))
    expect(radarCalls.length).toBeGreaterThan(0)
    expect(radarCalls.every((u) => u.includes('/nx3hail/2026'))).toBe(true)
  })

  /**
   * Regression. Radar used to be gated on loadEnv(), which validates the whole
   * schema and throws when VITE_SUPABASE_URL is absent — so on any machine
   * without a .env, radar reported "not configured" for a reason that had
   * nothing to do with radar. It passed locally (a .env was sitting there) and
   * failed the moment CI ran on a clean checkout.
   *
   * Radar is a public, keyless NOAA feed. No Supabase credential, valid or
   * otherwise, may decide whether it runs.
   */
  it('still runs radar when Supabase config is missing entirely', async () => {
    const env = import.meta.env as Record<string, unknown>
    const savedUrl = env['VITE_SUPABASE_URL']
    const savedKey = env['VITE_SUPABASE_ANON_KEY']
    delete env['VITE_SUPABASE_URL']
    delete env['VITE_SUPABASE_ANON_KEY']

    try {
      const { fetchImpl } = capturingFetch()
      const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })
      expect(run.coverage.radar.kind).toBe('live')
    } finally {
      if (savedUrl !== undefined) env['VITE_SUPABASE_URL'] = savedUrl
      if (savedKey !== undefined) env['VITE_SUPABASE_ANON_KEY'] = savedKey
    }
  })

  it('leaves radar off when the workspace has turned it off', async () => {
    const { urls, fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year', useRadar: false }), {
      fetchImpl,
      now: NOW,
    })

    expect(run.coverage.radar.kind).toBe('not_configured')
    expect(urls.some((u) => u.includes('swdiws'))).toBe(false)
  })

  /**
   * The stamp that lets the page tell "old" from "written by an engine that
   * did not have radar". Without it, a cached run minutes old kept the storm
   * panel reading NOT CONFIGURED after radar had shipped and deployed.
   */
  it('stamps the engine version on every run it writes', async () => {
    const { fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.engineVersion).toBe(ENGINE_VERSION)
    // A run cached before the stamp existed has no value here, and that
    // absence is what marks it stale. It must never equal the current one.
    expect(ENGINE_VERSION).toBeGreaterThan(0)
  })

  it('carries the qualifying storms so the count can be checked against the events', async () => {
    const { fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.stormEvents).toHaveLength(run.counts.stormsConsidered)
  })
})
