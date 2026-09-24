import { describe, expect, it } from 'vitest'
import { dailyRollup, exceptions, OPEN_ROUTE_HOURS } from '@/features/manager/daily'
import { factsFor, numbersIn, verifyBrief, writeBrief } from '@/features/manager/brief'
import type { ActivityRow, RouteRow } from '@/features/manager/metrics'

/**
 * The daily rollup, the exception list, and the guard that stops a brief
 * stating a number nobody computed.
 *
 * The guard is the interesting part. "The AI must not invent counts" is
 * worthless as an instruction in a prompt - a model asked to summarise
 * 24 appointments will cheerfully write "over two dozen" - so the rule is
 * enforced against the text instead of requested from the writer.
 */

const FROM = '2026-09-24T05:00:00.000Z'
const TO = '2026-09-25T04:59:59.999Z'
const NOW = Date.parse('2026-09-24T22:00:00.000Z')

function route(overrides: Partial<RouteRow> = {}): RouteRow {
  return {
    id: 'route-1',
    userId: 'rep-1',
    label: null,
    startedAt: '2026-09-24T13:00:00.000Z',
    endedAt: '2026-09-24T21:00:00.000Z',
    pointCount: 120,
    firstFixAt: '2026-09-24T13:01:00.000Z',
    lastFixAt: '2026-09-24T20:58:00.000Z',
    pauses: [],
    latitude: 30.41,
    longitude: -91.18,
    accuracyM: 15,
    ...overrides,
  }
}

function knock(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    userId: 'rep-1',
    activityType: 'door_knock',
    outcome: 'spoke',
    gpsVerification: 'verified',
    occurredAt: '2026-09-24T15:00:00.000Z',
    subdivision: 'Quail Ridge',
    address: '142 OAK RIDGE DR',
    leadClientId: 'lead-1',
    ...overrides,
  }
}

describe('daily rollup', () => {
  it('counts people, not routes', () => {
    const r = dailyRollup({
      from: FROM,
      to: TO,
      routes: [route({ id: 'a' }), route({ id: 'b' })],
      activity: [],
      now: NOW,
    })
    expect(r.routes).toBe(2)
    expect(r.repsOut).toBe(1)
  })

  it('counts doors, conversations and appointments the same way every other screen does', () => {
    const r = dailyRollup({
      from: FROM,
      to: TO,
      routes: [route()],
      activity: [
        knock(),
        knock({ leadClientId: 'lead-1', outcome: 'no_answer' }),
        knock({ leadClientId: 'lead-2', activityType: 'appointment', outcome: 'appointment_set' }),
      ],
      now: NOW,
    })
    expect(r.doors).toBe(2)
    expect(r.appointments).toBe(1)
  })

  it('leaves the window alone', () => {
    const r = dailyRollup({
      from: FROM,
      to: TO,
      routes: [route({ startedAt: '2026-09-20T13:00:00.000Z' })],
      activity: [knock({ occurredAt: '2026-09-20T15:00:00.000Z' })],
      now: NOW,
    })
    expect(r.routes).toBe(0)
    expect(r.doors).toBe(0)
  })

  /** Same rule as the funnel: an uncollected number is not a zero. */
  it('names what it cannot measure instead of reporting zeros', () => {
    const r = dailyRollup({ from: FROM, to: TO, routes: [], activity: [], now: NOW })
    expect(r.unmeasured).toContain('sales')
    expect(r.unmeasured).toContain('miles')
    expect(r).not.toHaveProperty('sales')
  })
})

describe('exceptions', () => {
  /**
   * Regression. This flag exists for the rep who forgot to tap End yesterday -
   * and yesterday's route, by definition, did not start today. Filtering
   * exceptions by the window hid the only case it was written for.
   */
  it('flags a route left open since yesterday, outside today’s window', () => {
    const stale = route({
      endedAt: null,
      startedAt: new Date(NOW - (OPEN_ROUTE_HOURS + 2) * 3_600_000).toISOString(),
    })
    expect(stale.startedAt < FROM).toBe(true)
    const found = exceptions({ from: FROM, to: TO, routes: [stale], activity: [], now: NOW })
    expect(found.some((e) => e.kind === 'route_never_ended')).toBe(true)
  })

  it('leaves an ordinary long day alone', () => {
    const open = route({ endedAt: null, startedAt: new Date(NOW - 9 * 3_600_000).toISOString() })
    const found = exceptions({ from: FROM, to: TO, routes: [open], activity: [], now: NOW })
    expect(found.some((e) => e.kind === 'route_never_ended')).toBe(false)
  })

  it('flags a finished route that recorded nothing at all', () => {
    const blind = route({ pointCount: 0 })
    const found = exceptions({ from: FROM, to: TO, routes: [blind], activity: [], now: NOW })
    expect(found.some((e) => e.kind === 'route_without_fixes')).toBe(true)
  })

  it('flags knocks with no outcome, which leave a door with nothing deciding its next step', () => {
    const found = exceptions({
      from: FROM,
      to: TO,
      routes: [route()],
      activity: [knock({ outcome: null }), knock({ outcome: null, leadClientId: 'lead-2' })],
      now: NOW,
    })
    expect(found.find((e) => e.kind === 'contacted_without_outcome')?.count).toBe(2)
  })

  /**
   * The threshold is high on purpose. Unverified is the ordinary result of a
   * basement or a flat battery, and a list that fires on normal field
   * conditions teaches a manager to ignore it.
   */
  it('does not flag a handful of unverified knocks', () => {
    const activity = Array.from({ length: 6 }, (_, i) =>
      knock({ gpsVerification: 'unverified', leadClientId: `lead-${i}` }),
    )
    const found = exceptions({ from: FROM, to: TO, routes: [route()], activity, now: NOW })
    expect(found.some((e) => e.kind === 'knocks_mostly_unverified')).toBe(false)
  })

  it('flags a phone that matched almost nothing all day', () => {
    const activity = Array.from({ length: 20 }, (_, i) =>
      knock({ gpsVerification: 'unverified', leadClientId: `lead-${i}` }),
    )
    const found = exceptions({ from: FROM, to: TO, routes: [route()], activity, now: NOW })
    const hit = found.find((e) => e.kind === 'knocks_mostly_unverified')
    expect(hit?.count).toBe(20)
    // Worded as a phone problem, not a person problem.
    expect(hit?.detail).toContain('phone rather than the rep')
  })
})

describe('the guard', () => {
  const rollup = dailyRollup({
    from: FROM,
    to: TO,
    routes: [route()],
    activity: [knock(), knock({ leadClientId: 'lead-2', outcome: 'appointment_set', activityType: 'appointment' })],
    now: NOW,
  })
  const facts = factsFor(rollup, [])

  it('finds numbers in every shape prose writes them', () => {
    expect(numbersIn('1,240 doors and 3.5 miles, 7 appointments')).toEqual([1240, 3.5, 7])
  })

  it('passes a brief built only from computed figures', () => {
    const text = writeBrief(facts).join(' ')
    expect(verifyBrief(text, facts).ok).toBe(true)
  })

  /** The whole reason the guard exists. */
  it('rejects a number nobody computed', () => {
    const check = verifyBrief('The team booked 24 appointments today.', facts)
    expect(check.ok).toBe(false)
    expect(check.unsupported).toContain(24)
  })

  it('rejects a rounded restatement of a real figure', () => {
    const check = verifyBrief(`About 25 doors were knocked.`, facts)
    expect(check.ok).toBe(false)
  })

  it('has no whitelist for years or dates', () => {
    expect(verifyBrief('A strong day for September 2026.', facts).ok).toBe(false)
  })

  it('accepts prose with no numbers at all', () => {
    expect(verifyBrief('The team worked the north side today.', facts).ok).toBe(true)
  })
})

describe('the deterministic brief', () => {
  it('says plainly when nobody went out', () => {
    const rollup = dailyRollup({ from: FROM, to: TO, routes: [], activity: [], now: NOW })
    const lines = writeBrief(factsFor(rollup, []))
    expect(lines[0]).toContain('No routes were run')
  })

  it('warns that figures are not final while a route is open', () => {
    const rollup = dailyRollup({
      from: FROM,
      to: TO,
      routes: [route({ endedAt: null })],
      activity: [knock()],
      now: NOW,
    })
    const lines = writeBrief(factsFor(rollup, [])).join(' ')
    expect(lines).toContain('not final')
  })

  it('names what it did not count', () => {
    const rollup = dailyRollup({ from: FROM, to: TO, routes: [route()], activity: [], now: NOW })
    expect(writeBrief(factsFor(rollup, [])).join(' ')).toContain('Not counted here')
  })
})
