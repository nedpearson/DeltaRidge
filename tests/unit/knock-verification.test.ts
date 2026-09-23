import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  UNKNOWN_ACCURACY_METERS,
  classifyKnock,
  metersBetween,
  worthReviewing,
  type KnockVerification,
} from '@/features/routes/verification'

/**
 * The rule this whole module exists to enforce: no claim about where somebody
 * was may be stronger than the accuracy the device itself reported.
 *
 * Getting this wrong in either direction is a real cost. Too strict and honest
 * reps are marked "unverified" for having a phone; too loose and the word
 * "verified" means nothing, which is worse, because somebody will eventually
 * make a decision about a person's job with it.
 */

const DOOR = { latitude: 30.4515, longitude: -91.1871 }

/** Roughly `meters` north of the door. */
function northOf(meters: number) {
  return { latitude: DOOR.latitude + meters / 111_320, longitude: DOOR.longitude }
}

describe('metersBetween', () => {
  it('measures a short distance to within a metre', () => {
    expect(metersBetween(DOOR.latitude, DOOR.longitude, northOf(100).latitude, DOOR.longitude)).toBeCloseTo(
      100,
      0,
    )
  })

  it('is zero for the same point', () => {
    expect(metersBetween(DOOR.latitude, DOOR.longitude, DOOR.latitude, DOOR.longitude)).toBe(0)
  })
})

describe('classifyKnock', () => {
  it('verifies only when the whole accuracy circle is inside the door radius', () => {
    // 10m away, accurate to 10m: worst case 20m, inside the 45m threshold.
    expect(classifyKnock({ ...northOf(10), accuracyMeters: 10 }, DOOR).verification).toBe('verified')
  })

  it('refuses to verify a close fix that is not accurate enough to prove it', () => {
    // The case the whole module is built around. 10m from the door sounds
    // conclusive; with a 60m accuracy circle it is not, and calling it verified
    // would be the app inventing certainty the phone never had.
    expect(classifyKnock({ ...northOf(10), accuracyMeters: 60 }, DOOR).verification).toBe('probable')
  })

  it('marks a fix unverified only when even its best case is too far', () => {
    // 400m away, accurate to 20m: best case 380m, past the 150m threshold.
    expect(classifyKnock({ ...northOf(400), accuracyMeters: 20 }, DOOR).verification).toBe('unverified')
  })

  it('does not call a distant fix unverified when its accuracy could explain it', () => {
    // 300m away but accurate only to 250m: the rep could have been at the door.
    // Saying otherwise would be an accusation the evidence cannot carry.
    expect(classifyKnock({ ...northOf(300), accuracyMeters: 250 }, DOOR).verification).toBe('probable')
  })

  it('treats no fix as unavailable, never as a failure to be somewhere', () => {
    const result = classifyKnock(null, DOOR)
    expect(result.verification).toBe('gps_unavailable')
    expect(result.distanceMeters).toBeNull()
    // Deliberately not phrased as the rep's fault.
    expect(result.explanation).toContain('No location fix')
  })

  it('treats an unmapped property as unavailable rather than blaming the rep', () => {
    const result = classifyKnock({ ...northOf(5), accuracyMeters: 5 }, null)
    expect(result.verification).toBe('gps_unavailable')
    expect(result.explanation).toContain('property')
  })

  it('never verifies when the device reported no accuracy at all', () => {
    // Assuming perfect accuracy is exactly how a coarse network fix becomes
    // "verified". The fallback is deliberately larger than the door radius.
    expect(UNKNOWN_ACCURACY_METERS).toBeGreaterThan(DEFAULT_THRESHOLDS.atDoorMeters)
    expect(classifyKnock({ ...northOf(1) }, DOOR).verification).toBe('probable')
  })

  it('ignores a negative or nonsense accuracy rather than trusting it', () => {
    expect(classifyKnock({ ...northOf(1), accuracyMeters: -5 }, DOOR).verification).toBe('probable')
    expect(classifyKnock({ ...northOf(1), accuracyMeters: Number.NaN }, DOOR).verification).toBe('probable')
  })

  it('reports the distance and accuracy it reasoned from', () => {
    // So a manager can check the verdict instead of taking it on faith.
    const result = classifyKnock({ ...northOf(200), accuracyMeters: 15 }, DOOR)
    expect(result.distanceMeters).toBeCloseTo(200, -1)
    expect(result.accuracyMeters).toBe(15)
  })

  it('honours wider thresholds for a rural parish', () => {
    const rural = { atDoorMeters: 120, nearbyMeters: 400 }
    expect(classifyKnock({ ...northOf(80), accuracyMeters: 20 }, DOOR, rural).verification).toBe('verified')
  })
})

describe('worthReviewing', () => {
  const many = (n: number, c: KnockVerification): KnockVerification[] => Array.from({ length: n }, () => c)

  it('says nothing about a handful of knocks', () => {
    // One bad afternoon is not a pattern, and flagging it would be the app
    // starting an argument on no evidence.
    expect(worthReviewing(many(4, 'unverified')).review).toBe(false)
  })

  it('flags a sustained run of knocks recorded away from the property', () => {
    const result = worthReviewing([...many(9, 'unverified'), ...many(2, 'verified')])
    expect(result.review).toBe(true)
    // Phrased as a question, not a verdict.
    expect(result.reason).toContain('Worth asking about')
  })

  it('does not punish a rep for working somewhere with no reception', () => {
    // Knocks with no fix are excluded from the denominator entirely.
    expect(worthReviewing(many(40, 'gps_unavailable')).review).toBe(false)
    expect(worthReviewing([...many(38, 'gps_unavailable'), ...many(2, 'unverified')]).review).toBe(false)
  })

  it('does not flag a day that is mostly consistent', () => {
    expect(worthReviewing([...many(8, 'probable'), ...many(2, 'unverified')]).review).toBe(false)
  })

  it('never flags on probable alone, however many there are', () => {
    // "Close, but the fix was coarse" is the normal condition of a phone in a
    // suburb. It is not evidence of anything.
    expect(worthReviewing(many(200, 'probable')).review).toBe(false)
  })
})
