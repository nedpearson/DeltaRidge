import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'

export const LEAD_INTELLIGENCE_VERSION = '2026-09-25.1'

export type LeadCertification = 'ultimate' | 'strong' | 'developing' | 'insufficient'

export interface EvidenceReason {
  label: string
  points: number
  detail: string
}

export interface LeadIntelligenceInput {
  scored: ScoredLead
  managed?: ManagedLead | null
  hasCurrentImagery: boolean
  imageryAgeDays?: number | null
  hasRoofMeasurement: boolean
  ownerIdentified: boolean
  ownerOccupied: boolean | null
  phonePresent: boolean
  emailPresent: boolean
  contactConfirmed: boolean
  contactSource:
    | 'homeowner'
    | 'public_record'
    | 'third_party_lookup'
    | 'unknown'
    | 'none'
  optedOut: boolean
  appointmentConfirmed?: boolean
  inboundResponse?: boolean
  referral?: boolean
  existingCustomer?: boolean
}

export interface LeadIntelligenceResult {
  propertyScore: number
  intentScore: number
  contactabilityScore: number
  overallPriority: number
  certification: LeadCertification
  propertyReasons: EvidenceReason[]
  intentReasons: EvidenceReason[]
  contactabilityReasons: EvidenceReason[]
  missingRequirements: string[]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function propertyScore(input: LeadIntelligenceInput): {
  score: number
  reasons: EvidenceReason[]
} {
  const reasons: EvidenceReason[] = []

  // Existing scoring is already a deterministic, evidence-backed property
  // priority index. Reuse it rather than inventing a competing hail/roof formula.
  reasons.push({
    label: 'Property priority',
    points: Math.round(input.scored.score * 0.7),
    detail: `Existing storm/roof/property priority index: ${input.scored.score}/100`,
  })

  let score = input.scored.score * 0.7

  if (input.ownerIdentified) {
    score += 7
    reasons.push({ label: 'Owner identified', points: 7, detail: 'Recorded owner is available.' })
  }

  if (input.ownerOccupied === true) {
    score += 5
    reasons.push({ label: 'Owner occupied', points: 5, detail: 'Assessor data indicates owner occupancy.' })
  }

  if (input.hasCurrentImagery) {
    const imageryPoints =
      input.imageryAgeDays === null || input.imageryAgeDays === undefined
        ? 6
        : input.imageryAgeDays <= 180
          ? 10
          : input.imageryAgeDays <= 365
            ? 8
            : 4
    score += imageryPoints
    reasons.push({
      label: 'Dated roof imagery',
      points: imageryPoints,
      detail:
        input.imageryAgeDays === null || input.imageryAgeDays === undefined
          ? 'Current imagery is available; exact freshness is stored with the source.'
          : `Imagery is about ${input.imageryAgeDays} days old.`,
    })
  }

  if (input.hasRoofMeasurement) {
    score += 8
    reasons.push({
      label: 'Roof measurements',
      points: 8,
      detail: 'A roof measurement record is available for proposal preparation.',
    })
  }

  return { score: clamp(score), reasons }
}

function intentScore(input: LeadIntelligenceInput): {
  score: number
  reasons: EvidenceReason[]
} {
  const reasons: EvidenceReason[] = []
  let score = 0

  const status = input.managed?.status

  if (input.existingCustomer) {
    score = Math.max(score, 45)
    reasons.push({
      label: 'Existing customer',
      points: 45,
      detail: 'Existing customer relationship is a direct intent/relationship signal.',
    })
  }

  if (input.referral) {
    score = Math.max(score, 55)
    reasons.push({
      label: 'Referral',
      points: 55,
      detail: 'Referral source is a strong observed intent signal.',
    })
  }

  if (input.inboundResponse) {
    score = Math.max(score, 60)
    reasons.push({
      label: 'Inbound response',
      points: 60,
      detail: 'Homeowner responded or initiated contact.',
    })
  }

  if (status === 'follow_up') {
    score = Math.max(score, 40)
    reasons.push({
      label: 'Requested follow-up',
      points: 40,
      detail: 'A future contact was requested or agreed.',
    })
  }

  if (status === 'need_visit') {
    score = Math.max(score, 70)
    reasons.push({
      label: 'Inspection interest',
      points: 70,
      detail: 'Homeowner wants the roof looked at.',
    })
  }

  if (status === 'appointment' || input.appointmentConfirmed) {
    score = Math.max(score, 90)
    reasons.push({
      label: 'Appointment',
      points: 90,
      detail: 'An appointment has been agreed.',
    })
  }

  if (status === 'inspected') {
    score = Math.max(score, 95)
    reasons.push({
      label: 'Inspection completed/started',
      points: 95,
      detail: 'The opportunity has progressed into inspection.',
    })
  }

  if (status === 'not_interested' || status === 'disqualified' || status === 'do_not_knock') {
    score = 0
    reasons.length = 0
    reasons.push({
      label: 'Not an active opportunity',
      points: 0,
      detail:
        status === 'do_not_knock'
          ? 'Homeowner/property is marked do not knock.'
          : status === 'disqualified'
            ? 'Property is marked not a prospect.'
            : 'Homeowner is marked not interested.',
    })
  }

  return { score: clamp(score), reasons }
}

function contactabilityScore(input: LeadIntelligenceInput): {
  score: number
  reasons: EvidenceReason[]
} {
  const reasons: EvidenceReason[] = []
  if (input.optedOut) {
    return {
      score: 0,
      reasons: [
        {
          label: 'Contact blocked',
          points: 0,
          detail: 'Opt-out/do-not-contact state overrides contact availability.',
        },
      ],
    }
  }

  let score = 0

  if (input.ownerIdentified) {
    score += 15
    reasons.push({
      label: 'Identity known',
      points: 15,
      detail: 'A recorded owner/customer identity is available.',
    })
  }

  if (input.phonePresent) {
    const points =
      input.contactSource === 'homeowner'
        ? 45
        : input.contactConfirmed
          ? 35
          : input.contactSource === 'public_record'
            ? 20
            : input.contactSource === 'third_party_lookup'
              ? 15
              : 10
    score += points
    reasons.push({
      label: 'Phone available',
      points,
      detail:
        input.contactSource === 'homeowner'
          ? 'Homeowner supplied the number.'
          : input.contactConfirmed
            ? 'Number is human-confirmed.'
            : `Number source: ${input.contactSource.replaceAll('_', ' ')}.`,
    })
  }

  if (input.emailPresent) {
    score += 15
    reasons.push({
      label: 'Email available',
      points: 15,
      detail: 'An email address is present on the record.',
    })
  }

  if (input.contactConfirmed) {
    score += 20
    reasons.push({
      label: 'Contact identity confirmed',
      points: 20,
      detail: 'A person confirmed the contact belongs to the homeowner/customer.',
    })
  }

  return { score: clamp(score), reasons }
}

function certification(input: LeadIntelligenceInput, scores: {
  property: number
  intent: number
  contactability: number
}): { certification: LeadCertification; missing: string[] } {
  const missing: string[] = []

  if (!input.ownerIdentified) missing.push('owner identity')
  if (!input.phonePresent && !input.emailPresent) missing.push('usable contact method')
  if (!input.contactConfirmed) missing.push('confirmed contact identity')
  if (!input.hasCurrentImagery) missing.push('dated roof imagery')
  if (!input.hasRoofMeasurement) missing.push('roof measurement')

  const disqualified =
    input.optedOut ||
    input.managed?.status === 'do_not_knock' ||
    input.managed?.status === 'disqualified' ||
    input.managed?.status === 'not_interested'

  if (disqualified) {
    return { certification: 'insufficient', missing: ['active homeowner opportunity'] }
  }

  // Ultimate is intentionally hard to earn. It means the property is strong,
  // the person is reachable, and either intent is observed or the record is
  // exceptionally complete. It never means "will close."
  if (
    scores.property >= 75 &&
    scores.contactability >= 70 &&
    scores.intent >= 70 &&
    missing.length <= 1
  ) {
    return { certification: 'ultimate', missing }
  }

  if (scores.property >= 65 && scores.contactability >= 45 && missing.length <= 3) {
    return { certification: 'strong', missing }
  }

  if (scores.property >= 45) return { certification: 'developing', missing }

  return { certification: 'insufficient', missing }
}

export function evaluateLeadIntelligence(input: LeadIntelligenceInput): LeadIntelligenceResult {
  const property = propertyScore(input)
  const intent = intentScore(input)
  const contactability = contactabilityScore(input)

  // Keep the three dimensions visible. Overall priority is only a queue sort.
  // Property matters most before contact; intent becomes dominant once observed.
  const overallPriority = clamp(
    property.score * 0.45 + intent.score * 0.35 + contactability.score * 0.2,
  )

  const cert = certification(input, {
    property: property.score,
    intent: intent.score,
    contactability: contactability.score,
  })

  return {
    propertyScore: property.score,
    intentScore: intent.score,
    contactabilityScore: contactability.score,
    overallPriority,
    certification: cert.certification,
    propertyReasons: property.reasons,
    intentReasons: intent.reasons,
    contactabilityReasons: contactability.reasons,
    missingRequirements: cert.missing,
  }
}
