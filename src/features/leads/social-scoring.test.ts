import { describe, it, expect } from 'vitest'
import { scoreSocialLead, type SocialScoringSignals } from './social-scoring'

describe('scoreSocialLead', () => {
  it('caps the score at 100 for a perfect lead', () => {
    const perfectLead: SocialScoringSignals = {
      hasRecentStormExposure: true,     // +25
      requestedInspection: true,        // +20
      hasActiveLeak: true,              // +15
      isConfirmedHomeowner: true,       // +15
      submittedPhotos: true,            // +10
      isRoofNearReplacementAge: true,   // +10
      initiatedInsuranceClaim: true,    // +10
      hasHighEngagement: true,          // +5
      isOutsideServiceArea: false,
      isUnresponsive: false,
      isNonOwner: false,
      isSpamOrBot: false,
    }

    const result = scoreSocialLead(perfectLead)
    
    // The sum is 110, but should be clamped to 100
    expect(result.score).toBe(100)
    expect(result.isQualifiedForAutoBooking).toBe(true)
    expect(result.breakdown.length).toBe(8)
  })

  it('drops score to zero and prevents auto-booking for out of area non-owners', () => {
    const badLead: SocialScoringSignals = {
      hasRecentStormExposure: false,
      requestedInspection: false,
      hasActiveLeak: false,
      isConfirmedHomeowner: false,
      submittedPhotos: false,
      isRoofNearReplacementAge: false,
      initiatedInsuranceClaim: false,
      hasHighEngagement: false,
      isOutsideServiceArea: true, // -10
      isUnresponsive: false,
      isNonOwner: true,           // -25
      isSpamOrBot: false,
    }

    const result = scoreSocialLead(badLead)
    
    expect(result.score).toBe(0)
    expect(result.isQualifiedForAutoBooking).toBe(false)
  })

  it('qualifies a standard hot storm lead for auto-booking', () => {
    const standardLead: SocialScoringSignals = {
      hasRecentStormExposure: true,     // +25
      requestedInspection: true,        // +20
      hasActiveLeak: false,
      isConfirmedHomeowner: true,       // +15
      submittedPhotos: false,
      isRoofNearReplacementAge: false,
      initiatedInsuranceClaim: false,
      hasHighEngagement: false,
      isOutsideServiceArea: false,
      isUnresponsive: false,
      isNonOwner: false,
      isSpamOrBot: false,
    }

    const result = scoreSocialLead(standardLead)
    
    // 25 + 20 + 15 = 60 (>= 50 threshold)
    expect(result.score).toBe(60)
    expect(result.isQualifiedForAutoBooking).toBe(true)
  })

  it('disqualifies a high scoring lead if they are out of the service area', () => {
    const outOfAreaLead: SocialScoringSignals = {
      hasRecentStormExposure: true,     // +25
      requestedInspection: true,        // +20
      hasActiveLeak: true,              // +15
      isConfirmedHomeowner: true,       // +15
      submittedPhotos: false,
      isRoofNearReplacementAge: false,
      initiatedInsuranceClaim: false,
      hasHighEngagement: false,
      isOutsideServiceArea: true,       // -10
      isUnresponsive: false,
      isNonOwner: false,
      isSpamOrBot: false,
    }

    const result = scoreSocialLead(outOfAreaLead)
    
    // 25 + 20 + 15 + 15 - 10 = 65
    expect(result.score).toBe(65)
    // Score is > 50, but should NOT auto-book because outside service area
    expect(result.isQualifiedForAutoBooking).toBe(false)
  })
})
