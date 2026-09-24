import { describe, expect, it } from 'vitest'
import {
  fieldToday,
  isPausedNow,
  locationNote,
  mappable,
} from '@/features/manager/field-today'
import type { ActivityRow, RouteRow } from '@/features/manager/metrics'

/**
 * The manager's field board.
 *
 * What is under test is the separation of two facts that every surveillance
 * dashboard eventually merges: whether a rep is on a route, which the rep
 * declared, and where their phone last was, which the phone reported. A rep
 * working a dead-signal subdivision is active with a forty-minute-old fix, and
 * a board that draws that as a pin is telling a manager something it does not
 * know.
 */

const NOW = Date.parse('2026-09-24T20:00:00.000Z')

function route(overrides: Partial<RouteRow> = {}): RouteRow {
  return {
    id: 'route-1',
    userId: 'rep-1',
    label: null,
    startedAt: '2026-09-24T13:00:00.000Z',
    endedAt: null,
    pointCount: 40,
    firstFixAt: '2026-09-24T13:01:00.000Z',
    lastFixAt: '2026-09-24T19:59:00.000Z',
    pauses: [],
    latitude: 30.41,
    longitude: -91.18,
    accuracyM: 18,
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
    subdivision: null,
    address: '142 OAK RIDGE DR',
    leadClientId: 'lead-1',
    ...overrides,
  }
}

describe('rep status', () => {
  it('is active on an open route with no break running', () => {
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [route()], activity: [], now: NOW })
    expect(row?.status).toBe('active')
  })

  it('is paused while a declared break is open', () => {
    const paused = route({ pauses: [{ at: '2026-09-24T19:00:00.000Z' }] })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [paused], activity: [], now: NOW })
    expect(row?.status).toBe('paused')
  })

  it('is active again once the break has ended', () => {
    const resumed = route({
      pauses: [{ at: '2026-09-24T18:00:00.000Z', until: '2026-09-24T18:30:00.000Z' }],
    })
    expect(isPausedNow(resumed, NOW)).toBe(false)
  })

  it('is ended once the rep closed the route', () => {
    const done = route({ endedAt: '2026-09-24T19:45:00.000Z' })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [done], activity: [], now: NOW })
    expect(row?.status).toBe('ended')
  })

  /**
   * A board that lists only who is working cannot answer "is anybody not out",
   * which is the question a manager opens it to ask.
   */
  it('includes a rep who did not go out', () => {
    const rows = fieldToday({ repIds: ['rep-1', 'rep-2'], routes: [route()], activity: [], now: NOW })
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.repId === 'rep-2')?.status).toBe('not_out')
  })

  it('prefers an open route over a later one that already ended', () => {
    const open = route({ id: 'open', startedAt: '2026-09-24T08:00:00.000Z' })
    const later = route({ id: 'later', startedAt: '2026-09-24T14:00:00.000Z', endedAt: '2026-09-24T15:00:00.000Z' })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [later, open], activity: [], now: NOW })
    expect(row?.routeId).toBe('open')
    expect(row?.status).toBe('active')
  })
})

describe('location freshness is not status', () => {
  /** The load-bearing separation. */
  it('stays active when the phone has gone quiet, and says the fix is stale', () => {
    const quiet = route({ lastFixAt: '2026-09-24T19:00:00.000Z' })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [quiet], activity: [], now: NOW })
    expect(row?.status).toBe('active')
    expect(row?.freshness).toBe('stale')
    expect(locationNote(row!)).toContain('not reported a position recently')
  })

  it('will not put a stale fix on the map', () => {
    const quiet = route({ lastFixAt: '2026-09-24T19:00:00.000Z' })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [quiet], activity: [], now: NOW })
    expect(mappable(row!)).toBe(false)
  })

  it('maps a rep whose fix is current', () => {
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [route()], activity: [], now: NOW })
    expect(row?.freshness).toBe('live')
    expect(mappable(row!)).toBe(true)
  })

  /** Pausing stops recording. A paused rep is never a pin. */
  it('will not map a rep who is on a declared break', () => {
    const paused = route({ pauses: [{ at: '2026-09-24T19:59:30.000Z' }] })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [paused], activity: [], now: NOW })
    expect(mappable(row!)).toBe(false)
    expect(locationNote(row!)).toContain('nothing is being recorded')
  })

  it('will not map a rep whose route has ended', () => {
    const done = route({ endedAt: '2026-09-24T19:59:00.000Z' })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [done], activity: [], now: NOW })
    expect(mappable(row!)).toBe(false)
  })

  it('will not map a route that has produced no position at all', () => {
    const blind = route({ lastFixAt: null, latitude: null, longitude: null })
    const [row] = fieldToday({ repIds: ['rep-1'], routes: [blind], activity: [], now: NOW })
    expect(row?.freshness).toBe('none')
    expect(mappable(row!)).toBe(false)
  })
})

describe('today the rep produced', () => {
  it('counts doors the same way the rep screen does', () => {
    const rows = fieldToday({
      repIds: ['rep-1'],
      routes: [route()],
      activity: [
        knock(),
        knock({ leadClientId: 'lead-1', outcome: 'no_answer' }),
        knock({ leadClientId: 'lead-2', outcome: 'no_answer' }),
        knock({ leadClientId: 'lead-3', activityType: 'appointment', outcome: 'appointment_set' }),
      ],
      now: NOW,
    })
    const row = rows[0]!
    // Three addresses, four knocks - one address knocked twice.
    expect(row.doors.doors).toBe(3)
    expect(row.doors.appointments).toBe(1)
  })

  it('does not attribute another rep’s work', () => {
    const rows = fieldToday({
      repIds: ['rep-1', 'rep-2'],
      routes: [route()],
      activity: [knock({ userId: 'rep-2', leadClientId: 'lead-9' })],
      now: NOW,
    })
    expect(rows.find((r) => r.repId === 'rep-1')?.doors.doors).toBe(0)
    expect(rows.find((r) => r.repId === 'rep-2')?.doors.doors).toBe(1)
  })

  it('counts inspections started at a door', () => {
    const rows = fieldToday({
      repIds: ['rep-1'],
      routes: [route()],
      activity: [knock({ outcome: 'inspect_now' })],
      now: NOW,
    })
    expect(rows[0]?.inspections).toBe(1)
  })

  it('puts the people who are out at the top', () => {
    const rows = fieldToday({
      repIds: ['idle', 'working'],
      routes: [route({ userId: 'working' })],
      activity: [],
      now: NOW,
    })
    expect(rows[0]?.repId).toBe('working')
  })
})
