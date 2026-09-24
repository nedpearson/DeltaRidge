import { doorTotals, type DoorEvent, type DoorTotals } from '@/features/routes/route-stats'
import { fixFreshness, type ActivityRow, type FixFreshness, type RouteRow } from './metrics'

/**
 * Who is out, and what today has produced.
 *
 * The manager's version of the route screen. It answers two questions that are
 * deliberately kept apart:
 *
 *   1. Is this rep on a route right now?      - a fact the rep declared
 *   2. Where was their phone last, and when?  - a fact the phone reported
 *
 * Merging them is the mistake this file exists to avoid. A rep can be genuinely
 * on a route, working, in a neighbourhood with no signal, and their last fix
 * can be forty minutes old. A board that renders that as a dot on a map is
 * telling a manager where somebody is, and it does not know. So status and
 * location freshness are separate fields, always, and the screen shows both.
 */

export type RepStatus =
  /** Route open, no pause running. */
  | 'active'
  /** Route open and the rep declared a break. Nothing is being recorded. */
  | 'paused'
  /** Started and ended a route today. */
  | 'ended'
  /** No route today. Not a judgement - it is a Tuesday in the office. */
  | 'not_out'

export const REP_STATUS_LABEL: Record<RepStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  not_out: 'Not out',
}

export interface RepFieldRow {
  readonly repId: string
  readonly status: RepStatus
  /** The route this status came from. Null when the rep has not been out. */
  readonly routeId: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
  /** When the phone last reported a position. Null if it never did. */
  readonly lastFixAt: string | null
  /**
   * How old that fix is, as a word. NEVER folded into `status`: a rep can be
   * active with a stale fix, and saying so is the whole point.
   */
  readonly freshness: FixFreshness
  readonly latitude: number | null
  readonly longitude: number | null
  readonly accuracyM: number | null
  readonly doors: DoorTotals
  /** Inspections started at a door today. */
  readonly inspections: number
}

/** Is a declared break currently open on this route? */
export function isPausedNow(route: RouteRow, now = Date.now()): boolean {
  for (const pause of route.pauses ?? []) {
    const from = Date.parse(pause.at)
    if (!Number.isFinite(from) || from > now) continue
    if (pause.until === undefined) return true
    const until = Date.parse(pause.until)
    if (Number.isFinite(until) && until > now) return true
  }
  return false
}

function statusOf(route: RouteRow | null, now: number): RepStatus {
  if (!route) return 'not_out'
  if (route.endedAt) return 'ended'
  return isPausedNow(route, now) ? 'paused' : 'active'
}

function toDoorEvent(row: ActivityRow): DoorEvent {
  return {
    leadId: row.leadClientId,
    at: row.occurredAt,
    activityType: row.activityType,
    outcome: row.outcome,
    gpsVerification: row.gpsVerification,
  }
}

/**
 * The rep's most relevant route: an open one if there is one, otherwise the
 * one that started most recently.
 *
 * An open route wins even if another started later, because "is this person
 * out right now" is the question the board is being asked, and a rep with two
 * routes open has one that is still running.
 */
function currentRoute(routes: readonly RouteRow[], repId: string): RouteRow | null {
  const mine = routes
    .filter((r) => r.userId === repId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return mine.find((r) => !r.endedAt) ?? mine[0] ?? null
}

export interface FieldTodayInput {
  /** Every rep the manager is authorised to see, so "not out" can be shown. */
  readonly repIds: readonly string[]
  readonly routes: readonly RouteRow[]
  readonly activity: readonly ActivityRow[]
  readonly now?: number
}

/**
 * One row per rep, including the ones who did not go out.
 *
 * Absent reps are included on purpose. A board that lists only who is working
 * cannot answer "is anybody not out today", which is the question a manager
 * opens it to ask. It carries no judgement - `not_out` is a Tuesday in the
 * office as often as it is anything else, and the label says only that.
 *
 * Doors are counted with the SAME function the rep's own screen uses, so the
 * number a manager sees and the number the rep saw at 5pm cannot drift apart.
 * Quotes and sales are not here: there is no source for them on this view, and
 * a zero column would read as a bad day rather than an uncollected number.
 */
export function fieldToday(input: FieldTodayInput): RepFieldRow[] {
  const now = input.now ?? Date.now()

  return input.repIds
    .map((repId): RepFieldRow => {
      const route = currentRoute(input.routes, repId)
      const mine = input.activity.filter((a) => a.userId === repId).map(toDoorEvent)

      return {
        repId,
        status: statusOf(route, now),
        routeId: route?.id ?? null,
        startedAt: route?.startedAt ?? null,
        endedAt: route?.endedAt ?? null,
        lastFixAt: route?.lastFixAt ?? null,
        freshness: fixFreshness(route?.lastFixAt ?? null, now),
        latitude: route?.latitude ?? null,
        longitude: route?.longitude ?? null,
        accuracyM: route?.accuracyM ?? null,
        doors: doorTotals(mine),
        inspections: mine.filter((e) => e.outcome === 'inspect_now').length,
      }
    })
    .sort(byStatusThenDoors)
}

const STATUS_RANK: Record<RepStatus, number> = {
  active: 0,
  paused: 1,
  ended: 2,
  not_out: 3,
}

function byStatusThenDoors(a: RepFieldRow, b: RepFieldRow): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.doors.doors - a.doors.doors
}

/**
 * Whether this row may be drawn on a live map.
 *
 * Four conditions, all required, and each one is a promise the product made:
 * the rep is on a route they started; they are not on a declared break, during
 * which nothing is recorded; there is a position at all; and it is recent
 * enough to mean anything. A stale fix is shown as a time on the rep's card,
 * never as a pin, because a pin says "here" and ten-minute-old GPS does not.
 */
export function mappable(row: RepFieldRow): boolean {
  return (
    row.status === 'active' &&
    row.latitude !== null &&
    row.longitude !== null &&
    (row.freshness === 'live' || row.freshness === 'recent')
  )
}

/** What the card says under the rep's name about where they are. */
export function locationNote(row: RepFieldRow): string {
  if (row.status === 'paused') return 'On a break — nothing is being recorded'
  if (row.status === 'ended') return 'Route ended'
  if (row.status === 'not_out') return 'No route today'
  switch (row.freshness) {
    case 'live':
    case 'recent':
      return row.accuracyM !== null
        ? `Last fix accurate to about ${Math.round(row.accuracyM)} m`
        : 'Last fix received'
    case 'stale':
      return 'On a route, but the phone has not reported a position recently'
    case 'none':
    default:
      return 'On a route, no position reported yet'
  }
}
