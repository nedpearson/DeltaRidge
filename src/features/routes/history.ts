import type { ContactEvent } from '@/features/leads/pipeline'
import type { RoutePoint, RouteSession } from './route-store'
import { routeStats, type DoorEvent, type RouteStats } from './route-stats'

/**
 * Past routes, made reviewable.
 *
 * A route that vanishes when the rep taps Done is a route nobody can check. The
 * whole argument for recording where somebody walked is that the record can be
 * looked at afterwards - by the rep who wants yesterday's street, and by a
 * manager asking what a day produced. If it is only ever a screen that appears
 * once and is dismissed, the recording was not worth asking for.
 */

// ---------------------------------------------------------------------------
// Which events belong to a route
// ---------------------------------------------------------------------------

/**
 * How a route's doors were found.
 *
 * This distinction is the whole reason 0034 exists and it survives into the UI
 * rather than being smoothed over, because the two are not equally trustworthy.
 *
 * `stamped`  - the activity recorded which route it happened on, at the moment
 *              it was captured. Correct even for work synced hours later, and
 *              correct on a day the rep forgot to end their route.
 * `inferred` - the activity predates the stamp, so the only thing available is
 *              "its timestamp falls inside this session". That is a guess, and
 *              it is exactly as wrong as it always was. It is used for old
 *              routes because the alternative is showing a rep an empty day
 *              they know they worked, and it is LABELLED.
 */
export type Attribution = 'stamped' | 'inferred' | 'none'

export interface RouteEvents {
  readonly events: DoorEvent[]
  readonly attribution: Attribution
}

function toDoorEvent(event: ContactEvent): DoorEvent {
  return {
    leadId: event.leadId,
    at: event.at,
    // Same mapping RoutePanel uses, so the recap counts a booked door the same
    // way here as it does live. See DOOR_ACTIVITY_TYPES in recap.ts.
    activityType: event.kind === 'appointment_set' ? 'appointment' : event.kind,
    outcome: event.outcome ?? null,
    gpsVerification: event.gps?.verification ?? null,
  }
}

/**
 * The doors worked on one route.
 *
 * Prefers the stamp and falls back to the time window only when NOTHING in the
 * whole set is stamped to this session. A partial fallback would be worse than
 * either: mixing recorded fact with a guess produces a number that cannot be
 * described honestly on screen.
 *
 * A running route (no endedAt) is windowed to `now` rather than left open, so a
 * session that was never ended cannot swallow every event since.
 */
export function eventsForSession(
  session: RouteSession,
  all: readonly ContactEvent[],
  now: string = new Date().toISOString(),
): RouteEvents {
  const stamped = all.filter((e) => e.routeSessionId === session.id)
  if (stamped.length > 0) {
    return { events: stamped.map(toDoorEvent), attribution: 'stamped' }
  }

  const from = session.startedAt
  const to = session.endedAt ?? now
  const windowed = all.filter((e) => e.at >= from && e.at <= to)
  return {
    events: windowed.map(toDoorEvent),
    attribution: windowed.length > 0 ? 'inferred' : 'none',
  }
}

// ---------------------------------------------------------------------------
// One day, summarised
// ---------------------------------------------------------------------------

export interface RouteDaySummary {
  readonly sessionId: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly stats: RouteStats
  readonly attribution: Attribution
  /** True while the route is still open. Its figures are not final. */
  readonly running: boolean
}

export function summariseSession(
  session: RouteSession,
  points: readonly RoutePoint[],
  all: readonly ContactEvent[],
  now: string = new Date().toISOString(),
): RouteDaySummary {
  const { events, attribution } = eventsForSession(session, all, now)
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    stats: routeStats(session, points, events, Date.parse(now)),
    attribution,
    running: session.endedAt === undefined || session.endedAt === null,
  }
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

export type HistoryWindowKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'all'

export const HISTORY_WINDOWS: readonly { key: HistoryWindowKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'all', label: 'All' },
]

export interface HistoryWindow {
  readonly key: HistoryWindowKey
  readonly label: string
  readonly from: string
  readonly to: string
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(23, 59, 59, 999)
  return out
}

/**
 * Resolves a preset against the rep's LOCAL clock.
 *
 * Local, not UTC, and deliberately. "Today" means the day the rep worked, and
 * a rep in Baton Rouge knocking at 7pm is already on tomorrow's date in UTC.
 * Using UTC here would put the last two hours of most evenings into the wrong
 * day, which is the sort of quiet wrongness nobody reports and everybody
 * stops trusting.
 *
 * Weeks start Monday: a roofing week is Monday to Saturday, and a Sunday-start
 * week splits it in the middle.
 */
export function resolveHistoryWindow(
  key: HistoryWindowKey,
  now: Date = new Date(),
): HistoryWindow {
  const label = HISTORY_WINDOWS.find((w) => w.key === key)?.label ?? 'All'
  const today = startOfDay(now)

  const mondayOf = (d: Date): Date => {
    const out = startOfDay(d)
    // getDay(): 0 = Sunday. Shift so Monday is the first day.
    const shift = (out.getDay() + 6) % 7
    out.setDate(out.getDate() - shift)
    return out
  }

  switch (key) {
    case 'today':
      return { key, label, from: today.toISOString(), to: endOfDay(now).toISOString() }
    case 'yesterday': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { key, label, from: y.toISOString(), to: endOfDay(y).toISOString() }
    }
    case 'this_week':
      return { key, label, from: mondayOf(now).toISOString(), to: endOfDay(now).toISOString() }
    case 'last_week': {
      const thisMonday = mondayOf(now)
      const lastMonday = new Date(thisMonday)
      lastMonday.setDate(lastMonday.getDate() - 7)
      const lastSunday = new Date(thisMonday)
      lastSunday.setDate(lastSunday.getDate() - 1)
      return {
        key,
        label,
        from: lastMonday.toISOString(),
        to: endOfDay(lastSunday).toISOString(),
      }
    }
    case 'this_month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      return { key, label, from: first.toISOString(), to: endOfDay(now).toISOString() }
    }
    case 'all':
    default:
      return { key: 'all', label: 'All', from: new Date(0).toISOString(), to: endOfDay(now).toISOString() }
  }
}

/**
 * Sessions that STARTED inside the window, newest first.
 *
 * Started, not overlapped. A route belongs to the day a rep set out on, and a
 * session running past midnight would otherwise appear on two days and be
 * counted twice by anything adding days together.
 */
export function sessionsInWindow(
  sessions: readonly RouteSession[],
  window: HistoryWindow,
): RouteSession[] {
  return sessions
    .filter((s) => s.startedAt >= window.from && s.startedAt <= window.to)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
