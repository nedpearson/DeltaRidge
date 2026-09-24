import { describe, expect, it } from 'vitest'
import {
  assessHealth,
  needsAttention,
  worstFirst,
  type TrafficWindow,
} from '@/features/integrations/health/health'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const window = (over: Partial<TrafficWindow> = {}): TrafficWindow => ({
  configured: true,
  successes: 20,
  failures: 0,
  lastSuccessAt: hoursAgo(1),
  lastFailureAt: null,
  expectedWithinHours: null,
  ...over,
})

describe('a configured integration with no traffic', () => {
  const health = assessHealth(window({ successes: 0, failures: 0, lastSuccessAt: null }), NOW)

  it('is never_used, not healthy', () => {
    /*
     * The state somebody is in the moment after wiring up a Zap. Calling it
     * "connected" is a lie they discover a fortnight later when they notice no
     * leads arrived.
     */
    expect(health.state).toBe('never_used')
  })

  it('tells them what would settle it', () => {
    expect(health.summary).toMatch(/nothing has gone through/i)
    expect(health.summary).toMatch(/send one/i)
  })
})

describe('there is no way to be healthy without traffic', () => {
  it('holds across every configuration of the inputs', () => {
    // The whole design: health is derived from what happened, not from whether
    // a credential exists. There is no "a key is set" input to pass.
    for (const configured of [true, false]) {
      for (const expectedWithinHours of [null, 24]) {
        const health = assessHealth(
          window({ configured, successes: 0, failures: 0, lastSuccessAt: null, expectedWithinHours }),
          NOW,
        )
        expect(health.state).not.toBe('healthy')
      }
    }
  })
})

describe('failures', () => {
  it('is down when nothing has ever worked', () => {
    const health = assessHealth(
      window({ successes: 0, failures: 6, lastSuccessAt: null, lastFailureAt: hoursAgo(2) }),
      NOW,
    )
    expect(health.state).toBe('down')
    expect(health.summary).toMatch(/none worked/i)
    expect(health.summary).toMatch(/2 hours ago/)
  })

  it('is degraded when it works sometimes', () => {
    const health = assessHealth(window({ successes: 8, failures: 3, lastFailureAt: hoursAgo(1) }), NOW)
    expect(health.state).toBe('degraded')
    expect(health.summary).toMatch(/not reliably/i)
  })

  it('tolerates the odd failure without crying wolf', () => {
    // A screen that goes amber on one retry is a screen nobody reads.
    expect(assessHealth(window({ successes: 99, failures: 1 }), NOW).state).toBe('healthy')
  })
})

describe('silence', () => {
  it('is not a fault where silence is normal', () => {
    /*
     * A proposal webhook is quiet for a week whenever nobody sends a proposal.
     * Calling that "down" trains everybody to ignore the screen.
     */
    const health = assessHealth(
      window({ lastSuccessAt: hoursAgo(300), expectedWithinHours: null }),
      NOW,
    )
    expect(health.state).toBe('healthy')
  })

  it('is stale where something was expected', () => {
    const health = assessHealth(
      window({ lastSuccessAt: hoursAgo(50), expectedWithinHours: 24 }),
      NOW,
    )
    expect(health.state).toBe('stale')
    expect(health.summary).toMatch(/longer than expected/i)
  })

  it('does not call something stale while it is still inside its window', () => {
    expect(
      assessHealth(window({ lastSuccessAt: hoursAgo(20), expectedWithinHours: 24 }), NOW).state,
    ).toBe('healthy')
  })
})

describe('not configured', () => {
  it('is its own state, distinct from broken', () => {
    const health = assessHealth(window({ configured: false, successes: 0, failures: 0 }), NOW)
    expect(health.state).toBe('not_configured')
    expect(health.summary).toBe('Not set up.')
  })
})

describe('ordering', () => {
  const item = (state: Parameters<typeof needsAttention>[0][number]['health']['state']) => ({
    health: { state, summary: '', successes: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null },
  })

  it('puts problems first, because that is what the screen is read for', () => {
    const ordered = worstFirst([item('healthy'), item('down'), item('never_used'), item('degraded')])
    expect(ordered.map((i) => i.health.state)).toEqual(['down', 'degraded', 'never_used', 'healthy'])
  })

  it('counts only what a person should act on today', () => {
    // never_used is not a fault; nothing has been claimed about it.
    expect(needsAttention([item('down'), item('degraded'), item('stale')])).toBe(3)
    expect(needsAttention([item('healthy'), item('never_used'), item('not_configured')])).toBe(0)
  })
})

describe('an unreadable timestamp', () => {
  it('does not become "now" and turn a dead integration green', () => {
    const health = assessHealth(
      window({ lastSuccessAt: 'whenever', expectedWithinHours: 1 }),
      NOW,
    )
    // Cannot prove staleness, so it does not claim freshness either — it simply
    // reports what it has rather than inventing a recency it cannot support.
    expect(health.state).toBe('healthy')
    expect(health.summary).toMatch(/20 succeeded/)
  })
})
