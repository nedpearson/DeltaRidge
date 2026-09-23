import { distanceMiles } from '@/features/leads/scoring'

/**
 * How good the GPS evidence for a knock was.
 *
 * Four classes, not a boolean, because "was the rep really there" has four
 * honest answers and collapsing them is how a tool for checking work becomes a
 * tool for accusing people. A missing fix and a fix that puts somebody down the
 * street are different facts about different situations.
 *
 * The rule running through all of it: a device reports a position AND its own
 * accuracy, and no claim may be stronger than that accuracy supports. A fix
 * fifteen metres from the door with a fifty-metre accuracy circle does not put
 * the rep at the door; it puts them somewhere in a circle that happens to
 * contain the door, and the honest word for that is "probable".
 */

export type KnockVerification = 'verified' | 'probable' | 'unverified' | 'gps_unavailable'

export interface VerificationThresholds {
  /**
   * Within this of the property, a rep counts as at the door. Generous on
   * purpose: parcel centroids are the middle of a lot, and a rep stands at the
   * front step of a house that may sit well back from it.
   */
  atDoorMeters: number
  /**
   * Beyond this, a fix does not place the rep at this door. Also generous: a
   * suburban lot is wide, and the neighbouring house is not far away.
   */
  nearbyMeters: number
}

/**
 * Defaults, deliberately loose.
 *
 * These are the numbers that decide whether a rep's morning shows up as
 * "unverified", so erring tight would manufacture suspicion out of ordinary
 * phone behaviour. They are configuration, not a constant, because a dense
 * street and a rural parish are not the same problem.
 */
export const DEFAULT_THRESHOLDS: VerificationThresholds = {
  atDoorMeters: 45,
  nearbyMeters: 150,
}

/**
 * What to assume when a device reports a position but no accuracy.
 *
 * Not zero. Treating an unknown accuracy as perfect is exactly the assumption
 * that turns a coarse network fix into "verified", which is the one mistake
 * this module exists to avoid.
 */
export const UNKNOWN_ACCURACY_METERS = 65

const METERS_PER_MILE = 1609.344

export interface Fix {
  latitude: number
  longitude: number
  /** The device's own accuracy estimate in metres, if it gave one. */
  accuracyMeters?: number | null | undefined
}

export interface VerificationResult {
  verification: KnockVerification
  /** Centre-to-centre distance, metres. Null when there was no fix. */
  distanceMeters: number | null
  /** The accuracy actually used, so a later reader can check the reasoning. */
  accuracyMeters: number | null
  /** One sentence, in the words the rep or manager should see. */
  explanation: string
}

export function metersBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  return distanceMiles(aLat, aLon, bLat, bLon) * METERS_PER_MILE
}

function round(n: number): number {
  return Math.round(n)
}

/**
 * Classifies one knock against the property it claims to be at.
 *
 * `verified` requires that the WHOLE accuracy circle sits within the door
 * radius — worst case inside the threshold. `unverified` requires that the
 * whole circle sits outside the nearby radius — best case still too far.
 * Everything between is `probable`, which is most of real life and is not a
 * criticism of anyone.
 */
export function classifyKnock(
  fix: Fix | null | undefined,
  property: { latitude: number; longitude: number } | null | undefined,
  thresholds: VerificationThresholds = DEFAULT_THRESHOLDS,
): VerificationResult {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return {
      verification: 'gps_unavailable',
      distanceMeters: null,
      accuracyMeters: null,
      // Said plainly, because this is the common case and it is nobody's fault.
      explanation: 'No location fix when this was recorded.',
    }
  }

  if (!property || !Number.isFinite(property.latitude) || !Number.isFinite(property.longitude)) {
    return {
      verification: 'gps_unavailable',
      distanceMeters: null,
      accuracyMeters: fix.accuracyMeters ?? null,
      // The gap is the address, not the rep.
      explanation: 'This property has no mapped location to check against.',
    }
  }

  const accuracy =
    typeof fix.accuracyMeters === 'number' && Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters >= 0
      ? fix.accuracyMeters
      : UNKNOWN_ACCURACY_METERS

  const distance = metersBetween(
    fix.latitude,
    fix.longitude,
    property.latitude,
    property.longitude,
  )

  if (distance + accuracy <= thresholds.atDoorMeters) {
    return {
      verification: 'verified',
      distanceMeters: round(distance),
      accuracyMeters: round(accuracy),
      explanation: `At the property — ${round(distance)}m away, accurate to ${round(accuracy)}m.`,
    }
  }

  if (distance - accuracy > thresholds.nearbyMeters) {
    return {
      verification: 'unverified',
      distanceMeters: round(distance),
      accuracyMeters: round(accuracy),
      // Phrased as what the phone said, not as what the rep did.
      explanation: `The phone placed this ${round(distance)}m from the property, accurate to ${round(accuracy)}m.`,
    }
  }

  return {
    verification: 'probable',
    distanceMeters: round(distance),
    accuracyMeters: round(accuracy),
    explanation: `Close — ${round(distance)}m away, but the fix is only accurate to ${round(accuracy)}m.`,
  }
}

/** Wording for a list, short enough for a lead card. */
export const VERIFICATION_LABEL: Record<KnockVerification, string> = {
  verified: 'GPS confirmed',
  probable: 'GPS consistent',
  unverified: 'GPS does not match',
  gps_unavailable: 'No GPS',
}

/**
 * Whether a run of knocks is worth a human looking at. NOT an accusation and
 * NOT automatic: it decides what a manager is shown, never what happens next.
 *
 * One bad fix is noise — a phone in a pocket, a cloudy afternoon, a house with
 * a metal roof. A pattern is a question worth asking, and even then the answer
 * is a conversation.
 */
export const REVIEW_MIN_KNOCKS = 8
export const REVIEW_UNVERIFIED_SHARE = 0.5

export function worthReviewing(
  classes: readonly KnockVerification[],
): { review: boolean; reason: string | null } {
  if (classes.length < REVIEW_MIN_KNOCKS) {
    return { review: false, reason: null }
  }
  // Knocks with no fix are excluded from the denominator entirely. Counting
  // them would flag whoever works the neighbourhood with bad reception.
  const decided = classes.filter((c) => c !== 'gps_unavailable')
  if (decided.length < REVIEW_MIN_KNOCKS) return { review: false, reason: null }

  const unverified = decided.filter((c) => c === 'unverified').length
  const share = unverified / decided.length
  if (share <= REVIEW_UNVERIFIED_SHARE) return { review: false, reason: null }

  return {
    review: true,
    reason:
      `${unverified} of ${decided.length} knocks with a usable fix were recorded away from the ` +
      `property. Worth asking about — phones and parcel maps are both wrong sometimes.`,
  }
}
