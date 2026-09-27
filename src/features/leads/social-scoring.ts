/**
 * Social Lead Scoring Engine.
 * 
 * Combines conversational intent signals (from AI/Inbox) with physical property 
 * intelligence (from existing scoring/permits engine) to produce a 0-100 score.
 */

export interface SocialScoringSignals {
  // Property / Physical Signals (Derived from property DB/permits)
  hasRecentStormExposure: boolean;
  isRoofNearReplacementAge: boolean;
  isOutsideServiceArea: boolean;
  
  // Conversational / Intent Signals (Derived from AI Chat)
  requestedInspection: boolean;
  hasActiveLeak: boolean;
  isConfirmedHomeowner: boolean;
  submittedPhotos: boolean;
  initiatedInsuranceClaim: boolean;
  hasHighEngagement: boolean;
  
  // Negative Signals
  isUnresponsive: boolean;
  isNonOwner: boolean;
  isSpamOrBot: boolean;
}

export interface ScoreFactor {
  label: string;
  points: number;
}

export interface SocialScoreResult {
  score: number;
  breakdown: ScoreFactor[];
  isQualifiedForAutoBooking: boolean;
}

const SOCIAL_WEIGHTS = {
  recentStormExposure: 25,
  requestedInspection: 20,
  activeLeak: 15,
  confirmedHomeowner: 15,
  submittedPhotos: 10,
  roofNearReplacementAge: 10,
  insuranceClaimInitiated: 10,
  highEngagement: 5,
  
  outsideServiceArea: -10,
  unresponsive: -15,
  nonOwner: -25,
  spamOrBot: -30,
};

export function scoreSocialLead(signals: SocialScoringSignals): SocialScoreResult {
  const breakdown: ScoreFactor[] = [];
  let totalScore = 0;

  // --- Positive Signals ---
  if (signals.hasRecentStormExposure) {
    totalScore += SOCIAL_WEIGHTS.recentStormExposure;
    breakdown.push({ label: 'Recent verified storm exposure', points: SOCIAL_WEIGHTS.recentStormExposure });
  }
  if (signals.requestedInspection) {
    totalScore += SOCIAL_WEIGHTS.requestedInspection;
    breakdown.push({ label: 'Explicitly requested inspection', points: SOCIAL_WEIGHTS.requestedInspection });
  }
  if (signals.hasActiveLeak) {
    totalScore += SOCIAL_WEIGHTS.activeLeak;
    breakdown.push({ label: 'Active leak reported', points: SOCIAL_WEIGHTS.activeLeak });
  }
  if (signals.isConfirmedHomeowner) {
    totalScore += SOCIAL_WEIGHTS.confirmedHomeowner;
    breakdown.push({ label: 'Confirmed homeowner/property owner', points: SOCIAL_WEIGHTS.confirmedHomeowner });
  }
  if (signals.submittedPhotos) {
    totalScore += SOCIAL_WEIGHTS.submittedPhotos;
    breakdown.push({ label: 'Submitted photos of damage', points: SOCIAL_WEIGHTS.submittedPhotos });
  }
  if (signals.isRoofNearReplacementAge) {
    totalScore += SOCIAL_WEIGHTS.roofNearReplacementAge;
    breakdown.push({ label: 'Roof likely near replacement age', points: SOCIAL_WEIGHTS.roofNearReplacementAge });
  }
  if (signals.initiatedInsuranceClaim) {
    totalScore += SOCIAL_WEIGHTS.insuranceClaimInitiated;
    breakdown.push({ label: 'Insurance claim initiated', points: SOCIAL_WEIGHTS.insuranceClaimInitiated });
  }
  if (signals.hasHighEngagement) {
    totalScore += SOCIAL_WEIGHTS.highEngagement;
    breakdown.push({ label: 'High conversational engagement', points: SOCIAL_WEIGHTS.highEngagement });
  }

  // --- Negative Signals ---
  if (signals.isOutsideServiceArea) {
    totalScore += SOCIAL_WEIGHTS.outsideServiceArea;
    breakdown.push({ label: 'Outside service area', points: SOCIAL_WEIGHTS.outsideServiceArea });
  }
  if (signals.isUnresponsive) {
    totalScore += SOCIAL_WEIGHTS.unresponsive;
    breakdown.push({ label: 'Unresponsive after repeated attempts', points: SOCIAL_WEIGHTS.unresponsive });
  }
  if (signals.isNonOwner) {
    totalScore += SOCIAL_WEIGHTS.nonOwner;
    breakdown.push({ label: 'Non-owner / No authorization', points: SOCIAL_WEIGHTS.nonOwner });
  }
  if (signals.isSpamOrBot) {
    totalScore += SOCIAL_WEIGHTS.spamOrBot;
    breakdown.push({ label: 'Spam / Bot behavior', points: SOCIAL_WEIGHTS.spamOrBot });
  }

  // Clamp score between 0 and 100
  const finalScore = Math.max(0, Math.min(100, totalScore));

  // Determine auto-booking eligibility (e.g. score > 50, in service area, is homeowner)
  const isQualifiedForAutoBooking = 
    finalScore >= 50 && 
    !signals.isOutsideServiceArea && 
    !signals.isNonOwner && 
    !signals.isSpamOrBot;

  return {
    score: finalScore,
    breakdown,
    isQualifiedForAutoBooking
  };
}
