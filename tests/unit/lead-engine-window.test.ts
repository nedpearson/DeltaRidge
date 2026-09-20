import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, runLeadEngine, type LeadRunSettings } from '@/features/leads/engine'

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
    expect(run.coverage.totalEvents).toBe(0)
    expect(run.coverage.radar.kind).toBe('not_configured')
    expect(run.notes.join(' ')).toContain('Radar-estimated hail is not configured')
  })

  it('names the radar gap rather than blending it into the official count', async () => {
    const { fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.coverage.official).not.toEqual(run.coverage.radar)
    if (run.coverage.radar.kind !== 'not_configured') throw new Error('radar should be unconfigured')
    expect(run.coverage.radar.why).toContain('MRMS/MESH')
  })

  it('carries the qualifying storms so the count can be checked against the events', async () => {
    const { fetchImpl } = capturingFetch()

    const run = await runLeadEngine(settings({ windowKey: 'this_year' }), { fetchImpl, now: NOW })

    expect(run.stormEvents).toHaveLength(run.counts.stormsConsidered)
  })
})
