import { segmentsOf, type Segment } from './tracking'
import type { RoutePoint } from './route-store'

/**
 * Where the rep stood still.
 *
 * The obvious algorithm — cluster nearby fixes — is wrong for this app, and
 * wrong in a way that would have produced no stops at all. The sampling rule
 * drops any fix within twelve metres of the last one, precisely so a phone
 * standing on a doorstep does not emit a cloud of jitter. A rep who talks to
 * somebody for eleven minutes therefore produces TWO points, not two hundred,
 * and a clustering algorithm sees nothing to cluster.
 *
 * So a stop is read from the gap between consecutive kept fixes: two positions
 * close together in space and far apart in time mean the phone did not move.
 * That is a fact about the phone. It is not a fact about what the person was
 * doing, and nothing in this file names an activity.
 */

export interface StopRule {
  /** Two fixes closer than this are the same place. */
  radiusMeters: number
  /** Below this, standing still is just a red light. */
  minSeconds: number
  /**
   * Beyond this, the trail stopped rather than the rep.
   *
   * A long silence with two nearby endpoints is ambiguous: a phone that lost
   * signal on a doorstep and a phone that lost signal in a pocket look
   * identical. Past this threshold it is reported as a gap and not as a stop,
   * because the alternative is inventing eleven minutes of standing.
   */
  maxSilenceSeconds: number
}

export const DEFAULT_STOP_RULE: StopRule = {
  radiusMeters: 45,
  minSeconds: 120,
  maxSilenceSeconds: 1800,
}

export interface Stop {
  startedAt: string
  endedAt: string
  seconds: number
  latitude: number
  longitude: number
  /**
   * The worst accuracy of the fixes that bound this stop, in metres. Every
   * statement about where this stop happened is bounded by it.
   */
  accuracyMeters: number | null
  /** How many recorded fixes this stop was read from. Always small; see above. */
  fixes: number
}

function bounding(segment: Segment): number | null {
  const a = segment.from.accuracyMeters
  const b = segment.to.accuracyMeters
  const known = [a, b].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return known.length === 0 ? null : Math.max(...known)
}

/**
 * Stops, oldest first.
 *
 * Consecutive stationary stretches are merged, so a rep who produced three
 * fixes over twenty minutes in one driveway is reported as one twenty-minute
 * stop rather than two ten-minute ones.
 */
export function detectStops(
  points: readonly RoutePoint[],
  rule: StopRule = DEFAULT_STOP_RULE,
): Stop[] {
  const out: Stop[] = []
  let open: { segments: Segment[] } | null = null

  const flush = () => {
    if (!open) return
    const first = open.segments[0] as Segment
    const last = open.segments[open.segments.length - 1] as Segment
    const seconds = open.segments.reduce((total, s) => total + s.seconds, 0)
    if (seconds >= rule.minSeconds) {
      const accuracies = open.segments
        .map(bounding)
        .filter((v): v is number => v !== null)
      out.push({
        startedAt: first.from.recordedAt,
        endedAt: last.to.recordedAt,
        seconds,
        // The first fix of the stop, not an average. Averaging two positions
        // that are already uncertain produces a third place nobody was.
        latitude: first.from.latitude,
        longitude: first.from.longitude,
        accuracyMeters: accuracies.length > 0 ? Math.max(...accuracies) : null,
        fixes: open.segments.length + 1,
      })
    }
    open = null
  }

  for (const segment of segmentsOf(points)) {
    const stationary =
      segment.meters <= rule.radiusMeters &&
      segment.seconds >= 1 &&
      segment.seconds <= rule.maxSilenceSeconds

    if (stationary) {
      if (open) open.segments.push(segment)
      else open = { segments: [segment] }
    } else {
      flush()
    }
  }
  flush()

  return out
}

/** Total time the phone is known not to have moved. Not "time not working". */
export function stoppedSeconds(stops: readonly Stop[]): number {
  return stops.reduce((total, s) => total + s.seconds, 0)
}
