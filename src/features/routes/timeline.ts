import type { RoutePoint, RouteSession } from './route-store'
import { segmentsOf } from './tracking'
import { detectStops } from './stops'
import { OUTCOME_LABEL, asDoorOutcome } from '@/features/leads/pipeline'

/**
 * One afternoon, in order.
 *
 * The timeline is the thing a manager reads before deciding what they think of
 * somebody's day, so the things that are NOT in it matter as much as the things
 * that are. There is no "arrived in Santa Maria" event, because arriving
 * somewhere is a judgement about geography the app would be making up from two
 * coordinates. There is no "break" event either — only a pause the rep
 * declared, and a stop, which says the phone did not move and says nothing
 * about why.
 *
 * Gaps appear as their own events, in both directions. A trail that silently
 * skipped from 3:07 to 3:18 reads as continuous work; one that says the
 * tracking stopped and then came back reads as what happened.
 */

export type TimelineKind =
  | 'route_started'
  | 'route_ended'
  | 'paused'
  | 'resumed'
  | 'knock'
  | 'appointment'
  | 'note'
  | 'stop'
  | 'gap_started'
  | 'gap_ended'

export interface TimelineEntry {
  at: string
  kind: TimelineKind
  title: string
  detail?: string
  /** Set on door events, so playback can put a marker on the map. */
  latitude?: number
  longitude?: number
  leadId?: string
  /** The GPS verdict as it was judged at the time, on door events. */
  verification?: string
  /** Seconds, on stops and gaps. */
  seconds?: number
}

export interface TimelineActivity {
  leadId: string
  at: string
  activityType: string
  outcome: string | null
  gpsVerification: string | null
  address: string
  latitude?: number | null
  longitude?: number | null
  note?: string | null
}

function minutes(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function buildTimeline(
  session: RouteSession,
  points: readonly RoutePoint[],
  activities: readonly TimelineActivity[] = [],
): TimelineEntry[] {
  const out: TimelineEntry[] = []

  out.push({ at: session.startedAt, kind: 'route_started', title: 'Route started' })

  for (const pause of session.pauses ?? []) {
    out.push({
      at: pause.at,
      kind: 'paused',
      title: 'Paused',
      detail: 'The rep stopped recording. Nothing was captured until they resumed.',
    })
    if (pause.until) {
      out.push({ at: pause.until, kind: 'resumed', title: 'Resumed' })
    }
  }

  for (const segment of segmentsOf(points)) {
    if (!segment.gap) continue
    out.push({
      at: segment.from.recordedAt,
      kind: 'gap_started',
      title: 'Tracking stopped',
      detail: 'No fixes were recorded from here. What happened across it is not known.',
      seconds: segment.seconds,
    })
    out.push({
      at: segment.to.recordedAt,
      kind: 'gap_ended',
      title: 'Tracking restored',
      detail: `${minutes(segment.seconds)} with no record.`,
      seconds: segment.seconds,
    })
  }

  for (const stop of detectStops(points)) {
    out.push({
      at: stop.startedAt,
      kind: 'stop',
      title: `Stopped ${minutes(stop.seconds)}`,
      // Named without a cause on purpose. A doorstep conversation, a phone
      // call, a coffee and traffic all look identical from here.
      detail:
        stop.accuracyMeters === null
          ? 'The phone did not move. What was happening is not recorded.'
          : `The phone did not move, within ±${Math.round(stop.accuracyMeters)} m. What was happening is not recorded.`,
      latitude: stop.latitude,
      longitude: stop.longitude,
      seconds: stop.seconds,
    })
  }

  for (const activity of activities) {
    const outcome = asDoorOutcome(activity.outcome)
    const position =
      typeof activity.latitude === 'number' && typeof activity.longitude === 'number'
        ? { latitude: activity.latitude, longitude: activity.longitude }
        : {}

    if (activity.activityType === 'door_knock') {
      out.push({
        at: activity.at,
        kind: 'knock',
        title: `Knocked ${activity.address}`,
        ...(outcome ? { detail: OUTCOME_LABEL[outcome] } : {}),
        leadId: activity.leadId,
        ...(activity.gpsVerification ? { verification: activity.gpsVerification } : {}),
        ...position,
      })
    } else if (activity.activityType === 'appointment' || activity.activityType === 'appointment_set') {
      out.push({
        at: activity.at,
        kind: 'appointment',
        title: `Appointment booked — ${activity.address}`,
        leadId: activity.leadId,
        ...position,
      })
    } else if (activity.activityType === 'note') {
      out.push({
        at: activity.at,
        kind: 'note',
        title: `Note — ${activity.address}`,
        ...(activity.note ? { detail: activity.note } : {}),
        leadId: activity.leadId,
        ...position,
      })
    }
  }

  if (session.endedAt) {
    out.push({
      at: session.endedAt,
      kind: 'route_ended',
      title: session.endedReason === 'abandoned' ? 'Route left open, closed by the app' : 'Route ended',
    })
  }

  return out.sort((a, b) => a.at.localeCompare(b.at))
}
