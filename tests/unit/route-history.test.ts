import { describe, expect, it } from 'vitest'
import {
  eventsForSession,
  resolveHistoryWindow,
  sessionsInWindow,
  summariseSession,
} from '@/features/routes/history'
import type { RouteSession } from '@/features/routes/route-store'
import type { ContactEvent } from '@/features/leads/pipeline'

/**
 * Route history.
 *
 * The interesting test here is not that a list sorts. It is that a route's
 * doors are found by the STAMP where one exists and by the old timestamp guess
 * only where it does not - and that the difference survives into something the
 * screen can label, instead of being quietly averaged into one number that
 * looks equally trustworthy either way.
 */

const NOW = '2026-09-24T21:00:00.000Z'

function session(overrides: Partial<RouteSession> = {}): RouteSession {
  return {
    id: 'sess-1',
    startedAt: '2026-09-24T13:00:00.000Z',
    endedAt: '2026-09-24T20:00:00.000Z',
    deviceId: 'dev-1',
    pauses: [],
    ...overrides,
  } as RouteSession
}

/**
 * A route still running. Built by omitting endedAt rather than setting it to
 * undefined, which exactOptionalPropertyTypes rightly refuses.
 */
function openSession(overrides: Partial<RouteSession> = {}): RouteSession {
  const built: Record<string, unknown> = { ...session(overrides) }
  delete built['endedAt']
  return built as unknown as RouteSession
}

function event(overrides: Partial<ContactEvent> = {}): ContactEvent {
  return {
    id: 'evt-1',
    leadId: 'lead-1',
    at: '2026-09-24T14:00:00.000Z',
    kind: 'door_knock',
    outcome: 'spoke',
    ...overrides,
  }
}

describe('attributing events to a route', () => {
  it('uses the stamp when the activity carries one', () => {
    const result = eventsForSession(
      session(),
      [event({ routeSessionId: 'sess-1' }), event({ id: 'evt-2', routeSessionId: 'other' })],
      NOW,
    )
    expect(result.attribution).toBe('stamped')
    expect(result.events).toHaveLength(1)
  })

  /**
   * The stamp is right where the window is wrong. An activity written offline
   * and synced after the route ended still belongs to it.
   */
  it('keeps a stamped activity that falls outside the session window', () => {
    const result = eventsForSession(
      session(),
      [event({ at: '2026-09-24T23:30:00.000Z', routeSessionId: 'sess-1' })],
      NOW,
    )
    expect(result.attribution).toBe('stamped')
    expect(result.events).toHaveLength(1)
  })

  it('falls back to the time window for routes that predate the stamp', () => {
    const result = eventsForSession(session(), [event()], NOW)
    expect(result.attribution).toBe('inferred')
    expect(result.events).toHaveLength(1)
  })

  /**
   * Mixing a recorded fact with a guess produces a number that cannot be
   * described honestly on screen, so the fallback is all-or-nothing.
   */
  it('does not mix stamped and guessed events in one total', () => {
    const result = eventsForSession(
      session(),
      [event({ routeSessionId: 'sess-1' }), event({ id: 'evt-2' })],
      NOW,
    )
    expect(result.attribution).toBe('stamped')
    expect(result.events).toHaveLength(1)
  })

  it('reports none rather than inferred when there was nothing either way', () => {
    expect(eventsForSession(session(), [], NOW).attribution).toBe('none')
  })

  /**
   * A route nobody ended must not swallow every activity recorded since.
   */
  it('windows a still-running route to now, not to forever', () => {
    const open = openSession()
    const result = eventsForSession(
      open,
      [event({ at: '2026-09-26T14:00:00.000Z' })],
      NOW,
    )
    expect(result.events).toHaveLength(0)
  })
})

describe('summarising a day', () => {
  it('carries the attribution and the running flag through', () => {
    const done = summariseSession(session(), [], [event({ routeSessionId: 'sess-1' })], NOW)
    expect(done.attribution).toBe('stamped')
    expect(done.running).toBe(false)
    expect(done.stats.doors.doors).toBe(1)

    const open = summariseSession(openSession(), [], [], NOW)
    expect(open.running).toBe(true)
  })
})

describe('date windows', () => {
  // Thursday 24 September 2026, local time.
  const now = new Date(2026, 8, 24, 16, 30, 0)

  it('today covers the local day, not the UTC one', () => {
    const w = resolveHistoryWindow('today', now)
    expect(new Date(w.from).getDate()).toBe(24)
    expect(new Date(w.from).getHours()).toBe(0)
    expect(new Date(w.to).getDate()).toBe(24)
  })

  it('yesterday is the whole of the previous day', () => {
    const w = resolveHistoryWindow('yesterday', now)
    expect(new Date(w.from).getDate()).toBe(23)
    expect(new Date(w.to).getDate()).toBe(23)
  })

  /** A roofing week is Monday to Saturday; a Sunday start splits it. */
  it('starts the week on Monday', () => {
    const w = resolveHistoryWindow('this_week', now)
    expect(new Date(w.from).getDay()).toBe(1)
    expect(new Date(w.from).getDate()).toBe(21)
  })

  it('last week is the seven days before this Monday', () => {
    const w = resolveHistoryWindow('last_week', now)
    expect(new Date(w.from).getDate()).toBe(14)
    expect(new Date(w.to).getDate()).toBe(20)
  })

  it('this month starts on the first', () => {
    const w = resolveHistoryWindow('this_month', now)
    expect(new Date(w.from).getDate()).toBe(1)
    expect(new Date(w.from).getMonth()).toBe(8)
  })
})

describe('sessions in a window', () => {
  const now = new Date(2026, 8, 24, 16, 30, 0)

  it('returns newest first', () => {
    const a = session({ id: 'a', startedAt: new Date(2026, 8, 24, 8, 0).toISOString() })
    const b = session({ id: 'b', startedAt: new Date(2026, 8, 24, 13, 0).toISOString() })
    const rows = sessionsInWindow([a, b], resolveHistoryWindow('today', now))
    expect(rows.map((s) => s.id)).toEqual(['b', 'a'])
  })

  /**
   * A route belongs to the day it set out on. Overlap matching would put a
   * session running past midnight on two days, and anything adding days
   * together would count it twice.
   */
  it('matches on the day the route started, not on overlap', () => {
    const overnight = session({
      id: 'overnight',
      startedAt: new Date(2026, 8, 23, 22, 0).toISOString(),
      endedAt: new Date(2026, 8, 24, 2, 0).toISOString(),
    })
    expect(sessionsInWindow([overnight], resolveHistoryWindow('today', now))).toHaveLength(0)
    expect(sessionsInWindow([overnight], resolveHistoryWindow('yesterday', now))).toHaveLength(1)
  })
})
