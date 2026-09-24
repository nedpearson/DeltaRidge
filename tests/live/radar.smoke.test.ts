/* eslint-disable no-console */
/**
 * Opt-in check against the REAL NOAA SWDI service.
 * Excluded from the default run (see vite.config.ts). Run it by hand:
 *
 *   npx vitest run tests/live/radar.smoke.test.ts --exclude ''
 *
 * It prints as much as it asserts, because the question this answers is not
 * "did the code run" but "does this look like Baton Rouge weather" — and the
 * ratio at the bottom is the one to watch. If the share of radar estimates
 * with a ground report behind them collapses, the size floor is too low.
 */
import { describe, expect, it } from 'vitest'
import { SwdiStormProvider, NoaaStormProvider } from '@/integrations/storm'
import { flagCorroboration, SERVICE_AREA_BBOX, DEFAULT_SETTINGS } from '@/features/leads/engine'

describe('live radar hail', () => {
  it('pulls real NEXRAD hail detections for the service area', async () => {
    const to = new Date()
    const from = new Date(to)
    from.setMonth(from.getMonth() - 24)

    const query = {
      bbox: SERVICE_AREA_BBOX,
      from: from.toISOString(),
      to: to.toISOString(),
      eventTypes: ['hail' as const],
    }

    const radarFloor = DEFAULT_SETTINGS.radarMinHailInches ?? 1.25

    const started = Date.now()
    const [radar, official] = await Promise.all([
      new SwdiStormProvider().searchEvents({ ...query, minHailSizeInches: radarFloor }),
      new NoaaStormProvider().searchEvents({ ...query, minHailSizeInches: 1 }),
    ])
    const flagged = flagCorroboration(radar, official)
    const corroborated = flagged.filter((e) => e.radarConfidence === 'corroborated').length

    console.log('\n=== RADAR HAIL, LAST 24 MONTHS ==========')
    console.log('elapsed:', `${((Date.now() - started) / 1000).toFixed(1)}s`)
    console.log('official ground reports (>= 1.00"):', official.length)
    console.log(`radar estimates (>= ${radarFloor}"):`, radar.length)
    console.log(
      'corroborated within 10 mi same day:',
      corroborated,
      `(${((100 * corroborated) / Math.max(1, radar.length)).toFixed(1)}%)`,
    )

    const biggest = [...radar].sort((a, b) => (b.hailSizeInches ?? 0) - (a.hailSizeInches ?? 0))
    console.log('\n=== LARGEST 10 =========================')
    for (const e of biggest.slice(0, 10)) {
      console.log(
        `${String(e.hailSizeInches).padStart(5)}"  ${e.occurredAt.slice(0, 10)}  ` +
          `${e.latitude.toFixed(3)}, ${e.longitude.toFixed(3)}`,
      )
    }

    expect(radar.length).toBeGreaterThan(0)
    // One reading per place per day. More than a few hundred a year would mean
    // the collapse is not collapsing.
    expect(radar.length).toBeLessThan(2000)
    for (const e of radar) {
      expect(e.observation).toBe('radar_estimate')
      expect(e.hailSizeInches ?? 0).toBeGreaterThanOrEqual(radarFloor)
      expect(new Date(e.occurredAt).getTime()).toBeGreaterThanOrEqual(from.getTime())
      expect(new Date(e.occurredAt).getTime()).toBeLessThanOrEqual(to.getTime())
    }
    // Every id is distinct, or the database's unique (provider, external_id)
    // would silently drop events on ingestion.
    expect(new Set(radar.map((e) => e.externalId)).size).toBe(radar.length)
  }, 180000)
})
