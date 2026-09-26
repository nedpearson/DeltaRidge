import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import { distanceMiles, stormPhrase } from './scoring'
import { intelligenceFor } from './lead-intelligence'
import { mayContact } from './pipeline'

export interface AppointmentBrief {
  title: string
  scheduled: string | null
  homeowner: string
  address: string
  facts: string[]
  proof: string[]
  verify: string[]
  recommendedNext: string[]
}

export function appointmentBriefFor(
  lead: ManagedLead,
  scored?: ScoredLead,
): AppointmentBrief {
  const facts: string[] = []
  const proof: string[] = []
  const verify: string[] = []
  const recommendedNext: string[] = []

  if (scored) {
    const intel = intelligenceFor(scored, lead)
    facts.push(`Property opportunity ${intel.propertyOpportunity}/100`)
    if (scored.parcel?.ownerName) facts.push(`Recorded owner: ${scored.parcel.ownerName}`)
    if (scored.parcel?.occupancy === 'owner_occupied') facts.push('Assessor signal: owner occupied')
    facts.push(`Roof age basis: about ${scored.components.roofAgeYears.toFixed(1)} years`)

    const stormMiles = distanceMiles(
      scored.latitude,
      scored.longitude,
      scored.storm.latitude,
      scored.storm.longitude,
    )
    proof.push(stormPhrase(scored.storm, stormMiles))
    proof.push(`Roof-age source: permit dated ${new Date(scored.roofPermit.issuedAt).toLocaleDateString()}`)

    verify.push('Confirm current roof condition with close-range inspection.')
    verify.push('Confirm homeowner-reported roof age and any prior replacement/repair history.')
    if ((scored.storm.observation ?? 'official_report') === 'official_report') {
      verify.push('Nearby hail report is not proof hail struck this specific roof.')
    } else {
      verify.push('Radar hail estimate is not proof of roof-level impact.')
    }
  } else {
    verify.push('Refresh property/storm intelligence before presenting evidence.')
  }

  if (lead.contactPhone) {
    const call = mayContact(lead, 'call')
    facts.push(`Phone on record: ${lead.contactPhone}`)
    if (!call.allowed) verify.push(`Calling is not currently cleared: ${call.reason}`)
  } else {
    verify.push('No confirmed phone is stored on this lead.')
  }

  if (lead.appointmentAt) {
    recommendedNext.push('Confirm appointment timing and access instructions.')
  }
  recommendedNext.push('Review property evidence before arrival.')
  recommendedNext.push('Capture required inspection photos and homeowner statements in Lead 360.')
  recommendedNext.push('After inspection, create the estimate/proposal from measured scope rather than the opportunity score.')

  return {
    title:
      lead.status === 'appointment'
        ? 'Appointment prep brief'
        : lead.status === 'need_visit'
          ? 'Inspection opportunity brief'
          : 'Lead prep brief',
    scheduled: lead.appointmentAt ?? null,
    homeowner: lead.contactName ?? 'Homeowner name not confirmed',
    address: lead.address,
    facts,
    proof,
    verify: [...new Set(verify)],
    recommendedNext,
  }
}
