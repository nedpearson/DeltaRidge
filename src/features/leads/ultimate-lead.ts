import {
  contactSourceOf,
  isFromHomeowner,
  mayContact,
  type ContactEvent,
  type ManagedLead,
} from './pipeline'
import type { ScoredLead } from './scoring'

export interface LeadSignalScore {
  score: number
  label: string
  reasons: readonly string[]
}

export interface UltimateLeadAssessment {
  propertyOpportunity: LeadSignalScore
  homeownerIntent: LeadSignalScore
  contactability: LeadSignalScore
  tier: 'ultimate' | 'prime_target' | 'developing' | 'blocked'
  blockedReason: string | null
}

/**
 * These are transparent operating scores, NOT sale probabilities.
 *
 * Property opportunity is the existing evidence score. Intent is based only on
 * witnessed homeowner actions/status. Contactability is based only on contact
 * data + permission provenance. Nothing here claims a person will buy.
 */
export function assessUltimateLead(input: {
  scored: ScoredLead
  managed?: ManagedLead
  history?: readonly ContactEvent[]
}): UltimateLeadAssessment {
  const propertyOpportunity: LeadSignalScore = {
    score: input.scored.score,
    label: 'Property opportunity',
    reasons: input.scored.reasons,
  }

  const managed = input.managed
  if (!managed) {
    return {
      propertyOpportunity,
      homeownerIntent: {
        score: 0,
        label: 'Homeowner intent',
        reasons: ['No homeowner interaction has been recorded yet.'],
      },
      contactability: {
        score: 0,
        label: 'Contactability',
        reasons: ['No confirmed customer contact record exists yet.'],
      },
      tier: input.scored.score >= 75 ? 'prime_target' : 'developing',
      blockedReason: null,
    }
  }

  const history = input.history ?? []
  const intentReasons: string[] = []
  let intent = 0

  switch (managed.status) {
    case 'appointment':
      intent = 90
      intentReasons.push('A specific appointment time was agreed.')
      break
    case 'inspected':
      intent = 95
      intentReasons.push('An inspection was started/completed from this lead.')
      break
    case 'need_visit':
      intent = 70
      intentReasons.push('The homeowner asked to have the roof looked at.')
      break
    case 'follow_up':
      intent = 45
      intentReasons.push('The homeowner asked for another contact/visit.')
      break
    case 'attempted':
      intent = 10
      intentReasons.push('A knock was recorded, but no positive intent is established.')
      break
    case 'not_interested':
      intent = 0
      intentReasons.push('The homeowner was recorded as not interested.')
      break
    case 'disqualified':
      intent = 0
      intentReasons.push('The property/occupant was recorded as not a prospect.')
      break
    case 'do_not_knock':
      intent = 0
      intentReasons.push('The homeowner asked not to be approached.')
      break
    case 'new':
      intent = 0
      intentReasons.push('No homeowner interaction has established intent yet.')
      break
  }

  if (history.some((event) => event.outcome === 'appointment_set')) {
    intent = Math.max(intent, 90)
    intentReasons.push('Appointment-set activity appears in the lead history.')
  } else if (history.some((event) => event.outcome === 'wants_inspection')) {
    intent = Math.max(intent, 70)
    intentReasons.push('The homeowner asked for an inspection.')
  } else if (history.some((event) => event.outcome === 'interested')) {
    intent = Math.max(intent, 55)
    intentReasons.push('The homeowner was recorded as interested.')
  }

  const contactReasons: string[] = []
  let contactability = 0

  if (managed.optedOutAt !== undefined || managed.status === 'do_not_knock') {
    contactReasons.push('Contact is suppressed by an opt-out / do-not-knock record.')
    return {
      propertyOpportunity,
      homeownerIntent: {
        score: intent,
        label: 'Homeowner intent',
        reasons: intentReasons,
      },
      contactability: {
        score: 0,
        label: 'Contactability',
        reasons: contactReasons,
      },
      tier: 'blocked',
      blockedReason: 'Do not contact / do not knock',
    }
  }

  if (managed.contactPhone) {
    const source = contactSourceOf(managed)
    if (source !== null && isFromHomeowner(source)) {
      contactability += 45
      contactReasons.push('Phone number was provided by the homeowner.')
    } else {
      contactability += 20
      contactReasons.push('A phone number exists, but it was not provided by the homeowner.')
    }

    if (mayContact(managed, 'call').allowed) {
      contactability += 30
      contactReasons.push('Recorded permission allows a phone call.')
    }
    if (mayContact(managed, 'sms').allowed) {
      contactability += 15
      contactReasons.push('Recorded permission allows a text message.')
    }
  } else {
    contactReasons.push('No phone number is on the lead.')
  }

  if (managed.contactEmail) {
    contactability += 10
    contactReasons.push('An email address is on the lead.')
  }

  contactability = Math.min(100, contactability)

  const tier =
    propertyOpportunity.score >= 70 && intent >= 70 && contactability >= 70
      ? 'ultimate'
      : propertyOpportunity.score >= 75 && contactability >= 20
        ? 'prime_target'
        : 'developing'

  return {
    propertyOpportunity,
    homeownerIntent: {
      score: intent,
      label: 'Homeowner intent',
      reasons: intentReasons,
    },
    contactability: {
      score: contactability,
      label: 'Contactability',
      reasons: contactReasons,
    },
    tier,
    blockedReason: null,
  }
}

export const ULTIMATE_TIER_LABEL: Record<UltimateLeadAssessment['tier'], string> = {
  ultimate: 'Ultimate lead',
  prime_target: 'Prime target',
  developing: 'Developing',
  blocked: 'Blocked',
}
