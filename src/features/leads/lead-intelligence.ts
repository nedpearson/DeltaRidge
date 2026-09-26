import type { ScoredLead } from './scoring'
import {
  contactSourceOf,
  isFromHomeowner,
  mayContact,
  type ManagedLead,
} from './pipeline'

export interface LeadIntelligence {
  propertyOpportunity: number
  intent: number
  contactability: number
  level: 'property_only' | 'reachable' | 'engaged' | 'ultimate'
  gaps: string[]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function intentIndex(lead: ManagedLead | undefined): number {
  if (!lead) return 0
  if (lead.optedOutAt || lead.status === 'do_not_knock' || lead.status === 'not_interested') return 0

  switch (lead.status) {
    case 'new':
      return 5
    case 'attempted':
      return 10
    case 'follow_up':
      return 35
    case 'need_visit':
      return 70
    case 'appointment':
      return 90
    case 'inspected':
      return 100
    case 'disqualified':
      return 0
    default:
      return 0
  }
}

export function contactabilityIndex(lead: ManagedLead | undefined): number {
  if (!lead) return 0
  if (lead.optedOutAt || lead.status === 'do_not_knock') return 0

  let score = 0
  if (lead.contactName) score += 15
  if (lead.contactPhone) {
    score += 25
    const source = contactSourceOf(lead)
    if (source && isFromHomeowner(source)) score += 20
    if (mayContact(lead, 'call').allowed) score += 20
    if (mayContact(lead, 'sms').allowed) score += 10
  }
  if (lead.contactEmail) {
    score += 5
    if (mayContact(lead, 'email').allowed) score += 5
  }
  return clamp(score)
}

export function intelligenceFor(
  scored: ScoredLead,
  managed: ManagedLead | undefined,
): LeadIntelligence {
  const propertyOpportunity = clamp(scored.score)
  const intent = intentIndex(managed)
  const contactability = contactabilityIndex(managed)
  const gaps: string[] = []

  if (!scored.parcel?.ownerName) gaps.push('recorded owner not established')
  if (propertyOpportunity < 60) gaps.push('property opportunity is not yet strong')
  if (contactability < 60) gaps.push('homeowner contactability is not established')
  if (intent < 50) gaps.push('homeowner intent is not established')

  const level =
    propertyOpportunity >= 60 && contactability >= 60 && intent >= 70
      ? 'ultimate'
      : propertyOpportunity >= 60 && intent >= 50
        ? 'engaged'
        : propertyOpportunity >= 60 && contactability >= 60
          ? 'reachable'
          : 'property_only'

  return { propertyOpportunity, intent, contactability, level, gaps }
}

export const INTELLIGENCE_LEVEL_LABEL: Record<LeadIntelligence['level'], string> = {
  property_only: 'Property opportunity',
  reachable: 'Reachable opportunity',
  engaged: 'Engaged opportunity',
  ultimate: 'Ultimate lead',
}
