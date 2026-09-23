import { metersBetween } from './verification'
import { MIN_POINT_INTERVAL_MS, MIN_POINT_SPACING_METERS, type RoutePoint } from './route-store'

/**
 * Which fixes are worth keeping.
 *
 * A phone standing still in a pocket emits a steady drizzle of positions that
 * wander by tens of metres. Keeping them all would cost the rep battery and
 * signal, fill the outbox with hundreds of rows that say nothing, and — worse —
 * make a five-minute doorstep conversation look like somebody pacing the
 * street. Thinning is not data loss; it is the difference between a trail and
 * noise.
 *
 * Pure, so the rule can be tested without a clock, a phone, or a permission
 * prompt.
 */

export interface Candidate {
  recordedAt: string
  latitude: number
  longitude: number
  accuracyMeters?: number | undefined
}

export interface SamplingRule {
  minSpacingMeters: number
  minIntervalMs: number
  /** A fix coarser than this says nothing about which street they are on. */
  maxAccuracyMeters: number
}

export const DEFAULT_SAMPLING: SamplingRule = {
  minSpacingMeters: MIN_POINT_SPACING_METERS,
  minIntervalMs: MIN_POINT_INTERVAL_MS,
  maxAccuracyMeters: 200,
}

export type SampleDecision =
  | { keep: true }
  | { keep: false; reason: 'too-soon' | 'too-close' | 'too-coarse' | 'not-a-position' }

export function shouldKeepPoint(
  candidate: Candidate,
  previous: Pick<RoutePoint, 'recordedAt' | 'latitude' | 'longitude'> | null,
  rule: SamplingRule = DEFAULT_SAMPLING,
): SampleDecision {
  if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) {
    return { keep: false, reason: 'not-a-position' }
  }

  // Dropped rather than stored-and-ignored. A 500-metre fix in the trail would
  // later be drawn as a place the rep went.
  if (
    typeof candidate.accuracyMeters === 'number' &&
    Number.isFinite(candidate.accuracyMeters) &&
    candidate.accuracyMeters > rule.maxAccuracyMeters
  ) {
    return { keep: false, reason: 'too-coarse' }
  }

  // The first fix of a session is always kept: it is where the work started.
  if (!previous) return { keep: true }

  const elapsed = Date.parse(candidate.recordedAt) - Date.parse(previous.recordedAt)
  if (Number.isFinite(elapsed) && elapsed < rule.minIntervalMs) {
    return { keep: false, reason: 'too-soon' }
  }

  const moved = metersBetween(
    previous.latitude,
    previous.longitude,
    candidate.latitude,
    candidate.longitude,
  )
  if (moved < rule.minSpacingMeters) return { keep: false, reason: 'too-close' }

  return { keep: true }
}

/**
 * A gap in the trail, which is evidence of nothing and must be shown as such.
 *
 * The temptation with a sparse trail is to draw a straight line between two
 * points and call it the route. That line is an invention: it claims the rep
 * walked somewhere no fix ever recorded them. Gaps are found, labelled and
 * drawn differently, so a manager looking at a map can see where the evidence
 * stops rather than reading a confident line that nobody's phone supports.
 */
export const GAP_SECONDS = 300

export interface Segment {
  from: RoutePoint
  to: RoutePoint
  /** True when nothing was recorded between these two for longer than GAP_SECONDS. */
  gap: boolean
  seconds: number
  meters: number
}

export function segmentsOf(points: readonly RoutePoint[], gapSeconds = GAP_SECONDS): Segment[] {
  const out: Segment[] = []
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1] as RoutePoint
    const to = points[i] as RoutePoint
    const seconds = (Date.parse(to.recordedAt) - Date.parse(from.recordedAt)) / 1000
    out.push({
      from,
      to,
      gap: seconds > gapSeconds,
      seconds,
      meters: metersBetween(from.latitude, from.longitude, to.latitude, to.longitude),
    })
  }
  return out
}

/**
 * How far the rep is actually known to have walked.
 *
 * Gap segments are excluded. Whatever happened across a five-minute hole in the
 * trail — a drive, a coffee, a phone in a bag — measuring it as walking would
 * be making the number up, and this number is the kind that ends up in
 * somebody's performance review.
 */
export function walkedMeters(points: readonly RoutePoint[], gapSeconds = GAP_SECONDS): number {
  return segmentsOf(points, gapSeconds)
    .filter((s) => !s.gap)
    .reduce((total, s) => total + s.meters, 0)
}

/** Time between the first and last fix. Not "time worked" — nobody's phone knows that. */
export function trackedSeconds(points: readonly RoutePoint[]): number {
  if (points.length < 2) return 0
  const first = points[0] as RoutePoint
  const last = points[points.length - 1] as RoutePoint
  return Math.max(0, (Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / 1000)
}
