import { pausedSeconds, type RoutePoint, type RouteSession } from './route-store'
import { GAP_SECONDS, segmentsOf, trackedSeconds, walkedMeters } from './tracking'
import { detectStops, stoppedSeconds, type Stop } from './stops'
import { classifySegments, modeBreakdown, type ModeBreakdown } from './travel-mode'
import { asDoorOutcome, isConversation } from '@/features/leads/pipeline'

/**
 * Everything a route can honestly be said to have been.
 *
 * The rule the whole file obeys: a number is reported only if the evidence
 * supports it, and the pieces that do not add up are left visible instead of
 * being reconciled. Route duration, tracked time, paused time and gap time are
 * four different measurements of the same afternoon and they will not sum to
 * each other. Forcing them to — "active field time = duration − paused − gaps"
 * — would be inventing the missing minutes, and that arithmetic is exactly what
 * ends up on a timesheet.
 */

export interface DoorEvent {
  /** Which lead, so repeat knocks at one address are not counted as two doors. */
  leadId: string
  at: string
  activityType: string
  outcome: string | null
  gpsVerification: string | null
}

export interface DoorTotals {
  knocks: number
  /** Distinct addresses. A door knocked three times is one door. */
  doors: number
  conversations: number
  appointments: number
  verified: number
  probable: number
  unverified: number
  noFix: number
}

export interface RouteStats {
  sessionId: string
  startedAt: string
  endedAt: string | null
  /** Wall clock from start to stop, or to now while it is running. */
  routeSeconds: number
  /** Breaks the rep declared. Never inferred from the trail. */
  pausedSeconds: number
  /** First fix to last fix. Not "time worked"; nobody's phone knows that. */
  trackedSeconds: number
  /** Time inside stretches where nothing was recorded at all. */
  gapSeconds: number
  gapCount: number
  /** Time the phone is known not to have moved. Not "time not working". */
  stoppedSeconds: number
  /** Sum of the recorded stretches only. Gaps are excluded, never bridged. */
  distanceMeters: number
  fixes: number
  /** Worst accuracy of any kept fix, in metres. Bounds every claim above. */
  worstAccuracyMeters: number | null
  modes: ModeBreakdown
  stops: Stop[]
  doors: DoorTotals
}

export function doorTotals(events: readonly DoorEvent[]): DoorTotals {
  const totals: DoorTotals = {
    knocks: 0,
    doors: 0,
    conversations: 0,
    appointments: 0,
    verified: 0,
    probable: 0,
    unverified: 0,
    noFix: 0,
  }
  const addresses = new Set<string>()

  for (const event of events) {
    addresses.add(event.leadId)
    if (event.activityType === 'appointment' || event.activityType === 'appointment_set') {
      totals.appointments += 1
    }
    if (event.activityType !== 'door_knock') continue

    totals.knocks += 1
    const outcome = asDoorOutcome(event.outcome)
    if (outcome && isConversation(outcome)) totals.conversations += 1

    if (event.gpsVerification === 'verified') totals.verified += 1
    else if (event.gpsVerification === 'probable') totals.probable += 1
    else if (event.gpsVerification === 'unverified') totals.unverified += 1
    else totals.noFix += 1
  }

  totals.doors = addresses.size
  return totals
}

export function routeStats(
  session: RouteSession,
  points: readonly RoutePoint[],
  events: readonly DoorEvent[] = [],
  now = Date.now(),
): RouteStats {
  const segments = segmentsOf(points)
  const gaps = segments.filter((s) => s.gap)
  const classified = classifySegments(points)
  const stops = detectStops(points)

  const end = session.endedAt ? Date.parse(session.endedAt) : now
  const start = Date.parse(session.startedAt)

  const accuracies = points
    .map((p) => p.accuracyMeters)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    routeSeconds: Number.isFinite(start) && end > start ? (end - start) / 1000 : 0,
    pausedSeconds: pausedSeconds(session, now),
    trackedSeconds: trackedSeconds(points),
    gapSeconds: gaps.reduce((total, s) => total + s.seconds, 0),
    gapCount: gaps.length,
    stoppedSeconds: stoppedSeconds(stops),
    distanceMeters: walkedMeters(points),
    fixes: points.length,
    worstAccuracyMeters: accuracies.length > 0 ? Math.max(...accuracies) : null,
    modes: modeBreakdown(classified),
    stops,
    doors: doorTotals(events),
  }
}

// ---------------------------------------------------------------------------
// Planned against actual
// ---------------------------------------------------------------------------

export interface PlannedActual {
  assigned: number
  /** Assigned doors that were knocked. */
  knocked: number
  /** Assigned doors nobody recorded an outcome at. */
  skipped: number
  /** Doors worked that were never assigned. Not a fault; often the good ones. */
  additional: number
  /** Knocked over assigned. Null when nothing was assigned to complete. */
  completion: number | null
}

/**
 * What was handed out against what was worked.
 *
 * "Visited" is deliberately not a category. A rep whose GPS trail passed a
 * house did not visit it, and counting proximity as a visit would credit
 * somebody for driving down a street — which is the single easiest number in
 * this whole system to game, and the one a manager would most reasonably
 * believe. An outcome recorded at the door is the only evidence accepted here.
 */
export function plannedActual(
  assignedLeadIds: readonly string[],
  events: readonly DoorEvent[],
): PlannedActual {
  const assigned = new Set(assignedLeadIds)
  const knockedAt = new Set(
    events.filter((e) => e.activityType === 'door_knock').map((e) => e.leadId),
  )

  let knocked = 0
  for (const id of assigned) if (knockedAt.has(id)) knocked += 1

  let additional = 0
  for (const id of knockedAt) if (!assigned.has(id)) additional += 1

  return {
    assigned: assigned.size,
    knocked,
    skipped: assigned.size - knocked,
    additional,
    completion: assigned.size > 0 ? knocked / assigned.size : null,
  }
}

export { GAP_SECONDS }
