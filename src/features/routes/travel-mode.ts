import { segmentsOf, type Segment } from './tracking'
import type { RoutePoint } from './route-store'

/**
 * Walking, driving, or standing — with the uncertainty attached.
 *
 * This is an inference, and the app says so everywhere it shows one. Two fixes
 * ninety metres apart, each with a fifty-metre accuracy radius, are consistent
 * with a brisk walk and with not having moved at all; reporting "walking" from
 * that pair would be the app stating something it does not know. So every
 * classification carries a confidence, the confidence is computed from the
 * device's own accuracy numbers rather than chosen to look convincing, and a
 * caller that wants to sum "walking distance" has to decide what confidence it
 * will accept.
 *
 * `speedMps` from the device is preferred when it is there, because a Doppler
 * speed is measured rather than derived from two uncertain positions.
 */

export type TravelMode = 'stationary' | 'walking' | 'driving' | 'unclear'

export interface ModeRule {
  /** At or below this, the phone was not going anywhere. */
  stationaryMps: number
  /** Above stationary and at or below this reads as walking. Brisk walk ≈ 1.8 m/s. */
  walkingMaxMps: number
  /** At or above this, nobody is on foot. ≈ 11 mph. */
  drivingMinMps: number
}

/**
 * The band between 2.4 and 5.0 m/s is deliberately left UNCLEAR rather than
 * split down the middle. A slow crawl through a subdivision and a jog are the
 * same speed, and picking one would put a made-up mile into a distance figure
 * that ends up in a performance review.
 */
export const DEFAULT_MODE_RULE: ModeRule = {
  stationaryMps: 0.35,
  walkingMaxMps: 2.4,
  drivingMinMps: 5.0,
}

export interface ClassifiedSegment {
  from: string
  to: string
  seconds: number
  meters: number
  /** Null on a gap, where speed is meaningless. */
  speedMps: number | null
  mode: TravelMode
  /** 0–1. How much the geometry supports the call. */
  confidence: number
  gap: boolean
  /** Plain-language reason, shown rather than summarised. */
  why: string
}

function worstAccuracy(segment: Segment): number | null {
  const known = [segment.from.accuracyMeters, segment.to.accuracyMeters].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  return known.length === 0 ? null : Math.max(...known)
}

/**
 * How much of the measured distance is real rather than accuracy noise.
 *
 * Two fixes 30 m apart with 25 m accuracy each could be the same spot. The
 * ratio of distance to the uncertainty that bounds it is the honest measure of
 * how much this segment is worth believing, and it is the whole confidence
 * story — there is no fudge factor and no floor chosen to make the screen look
 * decisive.
 */
export function geometryConfidence(meters: number, accuracy: number | null): number {
  // No accuracy reported at all: the device told us nothing, so neither do we.
  if (accuracy === null) return 0.5
  if (meters <= 0) return accuracy <= 20 ? 0.8 : 0.5
  const ratio = meters / (accuracy * 2)
  if (ratio >= 3) return 0.95
  if (ratio <= 0.5) return 0.2
  // Linear between the two, which is defensible and easy to argue with.
  return 0.2 + ((ratio - 0.5) / 2.5) * 0.75
}

export function classifySegments(
  points: readonly RoutePoint[],
  rule: ModeRule = DEFAULT_MODE_RULE,
): ClassifiedSegment[] {
  return segmentsOf(points).map((segment) => {
    const base = {
      from: segment.from.recordedAt,
      to: segment.to.recordedAt,
      seconds: segment.seconds,
      meters: segment.meters,
      gap: segment.gap,
    }

    if (segment.gap) {
      return {
        ...base,
        speedMps: null,
        mode: 'unclear' as const,
        confidence: 0,
        why: 'Nothing was recorded across this stretch, so there is no evidence of how it was covered.',
      }
    }

    // A device-reported speed is measured; a derived one is two uncertain
    // positions divided by a clock. Prefer the measurement where it exists.
    const reported = segment.to.speedMps
    const derived = segment.seconds > 0 ? segment.meters / segment.seconds : 0
    const usingReported = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
    const speed = usingReported ? (reported as number) : derived

    const accuracy = worstAccuracy(segment)
    let confidence = geometryConfidence(segment.meters, accuracy)
    // A measured speed does not depend on the two positions being far apart.
    if (usingReported) confidence = Math.max(confidence, 0.8)

    let mode: TravelMode
    let why: string
    if (speed <= rule.stationaryMps) {
      mode = 'stationary'
      why = `About ${speed.toFixed(1)} m/s over ${Math.round(segment.seconds)}s — the phone did not go anywhere.`
    } else if (speed <= rule.walkingMaxMps) {
      mode = 'walking'
      why = `About ${speed.toFixed(1)} m/s, inside walking pace.`
    } else if (speed >= rule.drivingMinMps) {
      mode = 'driving'
      why = `About ${speed.toFixed(1)} m/s — too fast to be on foot.`
    } else {
      mode = 'unclear'
      // Confidence is floored down, not just reported: a speed in the band
      // genuinely does not distinguish a jog from a crawl.
      confidence = Math.min(confidence, 0.4)
      why = `About ${speed.toFixed(1)} m/s, which is as consistent with a slow drive as with a fast walk.`
    }

    return { ...base, speedMps: speed, mode, confidence, why }
  })
}

export interface ModeTotals {
  seconds: number
  meters: number
  /** Segments that carried this call at or above the confidence floor. */
  segments: number
}

export interface ModeBreakdown {
  walking: ModeTotals
  driving: ModeTotals
  stationary: ModeTotals
  /** Segments too uncertain to call, kept visible rather than shared out. */
  unclear: ModeTotals
  /** Nothing was recorded here at all. */
  gap: ModeTotals
  /** Mean confidence across the segments that were called something. */
  confidence: number | null
}

/** Below this a classification is reported as unclear rather than counted. */
export const MIN_MODE_CONFIDENCE = 0.5

const EMPTY: ModeTotals = { seconds: 0, meters: 0, segments: 0 }

/**
 * Distance and time by mode.
 *
 * `unclear` is a first-class bucket and is never redistributed into walking or
 * driving. A dashboard that shows 4.1 walking and 3.7 driving out of 7.8 total
 * has silently assigned every ambiguous metre to one side or the other; this
 * one shows 3.2 + 3.1 + 1.5 unclear and lets the manager see what is actually
 * known.
 */
export function modeBreakdown(
  segments: readonly ClassifiedSegment[],
  minConfidence = MIN_MODE_CONFIDENCE,
): ModeBreakdown {
  const out: ModeBreakdown = {
    walking: { ...EMPTY },
    driving: { ...EMPTY },
    stationary: { ...EMPTY },
    unclear: { ...EMPTY },
    gap: { ...EMPTY },
    confidence: null,
  }

  let confidenceSum = 0
  let confidenceCount = 0

  for (const segment of segments) {
    if (segment.gap) {
      out.gap.seconds += segment.seconds
      out.gap.segments += 1
      // Distance across a gap is deliberately NOT accumulated anywhere. The
      // straight line between two fixes is not a distance anybody travelled.
      continue
    }

    const called =
      segment.mode !== 'unclear' && segment.confidence >= minConfidence ? segment.mode : 'unclear'
    const bucket = out[called]
    bucket.seconds += segment.seconds
    bucket.meters += segment.meters
    bucket.segments += 1

    if (called !== 'unclear') {
      confidenceSum += segment.confidence
      confidenceCount += 1
    }
  }

  out.confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null
  return out
}
