import { doorTotals, type DoorEvent } from '@/features/routes/route-stats'
import type { ActivityRow, RouteRow } from './metrics'
import { isPausedNow } from './field-today'

/**
 * The day, totalled, and the things about it worth a second look.
 *
 * Two halves with different jobs. The rollup says what happened. The exception
 * list says what looks unfinished or unexplained. Neither is allowed to become
 * an accusation: every exception names a record and a fact about it, and the
 * wording is chosen so a manager reads "go and look at this", not "this person
 * did something wrong".
 *
 * This is also the input the AI brief is built from. Nothing downstream may
 * state a number that did not come out of here - see brief.ts, which enforces
 * that rather than trusting it.
 */

// ---------------------------------------------------------------------------
// The rollup
// ---------------------------------------------------------------------------

export interface DailyRollup {
  readonly from: string
  readonly to: string
  readonly repsOut: number
  readonly routes: number
  readonly routesStillOpen: number
  readonly doors: number
  readonly verified: number
  readonly conversations: number
  readonly appointments: number
  readonly inspections: number
  /**
   * Measures this rollup cannot produce, named so their absence is visible.
   *
   * Miles needs the full trail, which is deliberately not handed to this
   * screen; quotes, proposals and sales have no source here. Reporting any of
   * them as zero would read as a bad day rather than an uncollected number -
   * the same rule the funnel follows.
   */
  readonly unmeasured: readonly string[]
}

const UNMEASURED = ['miles', 'quotes', 'proposals', 'sales'] as const

function toDoorEvent(row: ActivityRow): DoorEvent {
  return {
    leadId: row.leadClientId,
    at: row.occurredAt,
    activityType: row.activityType,
    outcome: row.outcome,
    gpsVerification: row.gpsVerification,
  }
}

export interface DailyInput {
  readonly from: string
  readonly to: string
  readonly routes: readonly RouteRow[]
  readonly activity: readonly ActivityRow[]
  readonly now?: number
}

function inWindow(at: string, from: string, to: string): boolean {
  return at >= from && at <= to
}

export function dailyRollup(input: DailyInput): DailyRollup {
  const routes = input.routes.filter((r) => inWindow(r.startedAt, input.from, input.to))
  const activity = input.activity.filter((a) => inWindow(a.occurredAt, input.from, input.to))
  const totals = doorTotals(activity.map(toDoorEvent))

  return {
    from: input.from,
    to: input.to,
    // Distinct people, not routes. A rep who started two routes is one rep out.
    repsOut: new Set(routes.map((r) => r.userId)).size,
    routes: routes.length,
    routesStillOpen: routes.filter((r) => !r.endedAt).length,
    doors: totals.doors,
    verified: totals.verified,
    conversations: totals.conversations,
    appointments: totals.appointments,
    inspections: activity.filter((a) => a.outcome === 'inspect_now').length,
    unmeasured: UNMEASURED,
  }
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export type ExceptionKind =
  | 'route_never_ended'
  | 'route_without_fixes'
  | 'contacted_without_outcome'
  | 'knocks_mostly_unverified'

export interface ManagerException {
  readonly kind: ExceptionKind
  /** Who it concerns. Null when it is about a record rather than a person. */
  readonly repId: string | null
  /** The fact, stated flatly. Never an inference about intent. */
  readonly detail: string
  readonly count: number
}

/**
 * A route left open for longer than anyone works in a day.
 *
 * Deliberately generous. The point is to catch a rep who forgot to tap End -
 * which wrecks their own next-day figures, since an open route keeps claiming
 * the day - not to comment on long hours.
 */
export const OPEN_ROUTE_HOURS = 16

/**
 * The share of a rep's knocks that can be unverified before it is worth a look.
 *
 * High on purpose. Unverified is the ordinary result of a basement, a metal
 * roof, a dying battery or a phone in a coat pocket, and a threshold that fires
 * on normal field conditions trains a manager to ignore the whole list.
 */
export const UNVERIFIED_SHARE = 0.6
export const UNVERIFIED_MIN_KNOCKS = 10

export function exceptions(input: DailyInput): ManagerException[] {
  const now = input.now ?? Date.now()
  const routes = input.routes.filter((r) => inWindow(r.startedAt, input.from, input.to))
  const activity = input.activity.filter((a) => inWindow(a.occurredAt, input.from, input.to))
  const out: ManagerException[] = []

  // An open route is checked across EVERY route supplied, not only those that
  // started inside the window. The case this exists to catch is a rep who
  // forgot to tap End yesterday, and yesterday's route by definition did not
  // start today - filtering by the window hid the only exception it was
  // written for. Found by a test that expected the flag and did not get it.
  for (const route of input.routes) {
    if (route.endedAt) continue
    const openHours = (now - Date.parse(route.startedAt)) / 3_600_000
    if (!Number.isFinite(openHours) || openHours < OPEN_ROUTE_HOURS) continue
    out.push({
      kind: 'route_never_ended',
      repId: route.userId,
      detail: `A route has been open ${Math.floor(openHours)} hours. Until it is ended it keeps claiming the day, and their next day's figures start wrong.`,
      count: 1,
    })
  }

  for (const route of routes) {
    // A route that recorded nothing at all. Says nothing about whether they
    // worked - a denied permission looks exactly like this - but their knocks
    // cannot be checked against a trail that does not exist.
    if (route.endedAt && route.pointCount === 0 && !isPausedNow(route, now)) {
      out.push({
        kind: 'route_without_fixes',
        repId: route.userId,
        detail: 'A finished route recorded no GPS at all, so its knocks cannot be checked against a trail.',
        count: 1,
      })
    }
  }

  // Contact logged with nothing recorded about how it went. The lead sits in
  // the pipeline with no disposition and no next step implied by one.
  const noOutcome = activity.filter(
    (a) => a.activityType === 'door_knock' && (a.outcome === null || a.outcome === ''),
  )
  if (noOutcome.length > 0) {
    out.push({
      kind: 'contacted_without_outcome',
      repId: null,
      detail: `${noOutcome.length} knock${noOutcome.length === 1 ? '' : 's'} recorded with no outcome, so nothing decides what happens to those doors next.`,
      count: noOutcome.length,
    })
  }

  // Per rep, because an org-wide share hides one phone with location off.
  const byRep = new Map<string, { total: number; unverified: number }>()
  for (const a of activity) {
    if (a.activityType !== 'door_knock' || !a.userId) continue
    const cell = byRep.get(a.userId) ?? { total: 0, unverified: 0 }
    cell.total += 1
    if (a.gpsVerification !== 'verified' && a.gpsVerification !== 'probable') cell.unverified += 1
    byRep.set(a.userId, cell)
  }
  for (const [repId, cell] of byRep) {
    if (cell.total < UNVERIFIED_MIN_KNOCKS) continue
    const share = cell.unverified / cell.total
    if (share < UNVERIFIED_SHARE) continue
    out.push({
      kind: 'knocks_mostly_unverified',
      repId,
      detail: `${cell.unverified} of ${cell.total} knocks could not be matched to a GPS fix. Buildings, pockets and flat batteries all look like this; it is worth checking the phone rather than the rep.`,
      count: cell.unverified,
    })
  }

  return out
}
