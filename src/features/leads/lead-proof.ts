import { distanceMiles, stormPhrase, type ScoredLead } from './scoring'
import {
  contactSourceOf,
  isFromHomeowner,
  mayContact,
  type ManagedLead,
} from './pipeline'

export type ProofState = 'established' | 'supported' | 'limited' | 'blocked'

export interface LeadProofItem {
  key: string
  label: string
  value: string
  source: string
  state: ProofState
  limitation?: string
}

export interface LeadProof {
  headline: string
  items: LeadProofItem[]
  limitations: string[]
}

function money(value: number): string {
  return `$${value.toLocaleString()} assessed`
}

export function proofForLead(scored: ScoredLead, managed?: ManagedLead): LeadProof {
  const items: LeadProofItem[] = []
  const limitations: string[] = []
  const parcel = scored.parcel
  const stormDistance = distanceMiles(
    scored.latitude,
    scored.longitude,
    scored.storm.latitude,
    scored.storm.longitude,
  )

  items.push({
    key: 'storm',
    label: 'Storm evidence',
    value: stormPhrase(scored.storm, stormDistance),
    source:
      (scored.storm.observation ?? 'official_report') === 'official_report'
        ? 'NWS Local Storm Report'
        : 'NOAA NCEI NEXRAD hail estimate',
    state:
      (scored.storm.observation ?? 'official_report') === 'official_report'
        ? 'supported'
        : scored.storm.radarConfidence === 'corroborated'
          ? 'supported'
          : 'limited',
    limitation:
      (scored.storm.observation ?? 'official_report') === 'official_report'
        ? 'A nearby report documents hail at the report location, not a measurement on this roof.'
        : 'Radar estimates hail aloft; it does not prove hail struck this roof.',
  })

  items.push({
    key: 'roof-age',
    label: 'Roof age basis',
    value: `About ${scored.components.roofAgeYears.toFixed(1)} years`,
    source: `Building permit dated ${new Date(scored.roofPermit.issuedAt).toLocaleDateString()}`,
    state: 'supported',
    limitation: 'Permit history is evidence of construction/re-roof timing, not a current-condition inspection.',
  })

  if (parcel?.ownerName) {
    items.push({
      key: 'owner',
      label: 'Recorded owner',
      value: parcel.ownerName,
      source: `${parcel.parish} assessor · retrieved ${new Date(parcel.retrievedAt).toLocaleDateString()}`,
      state: parcel.ownerConfidence === 'high' ? 'established' : 'supported',
      limitation:
        parcel.ownerConfidence === 'high'
          ? undefined
          : `Owner match confidence is ${parcel.ownerConfidence}; confirm before relying on the name.`,
    })
  } else {
    items.push({
      key: 'owner',
      label: 'Recorded owner',
      value: 'Not established',
      source: 'Parcel record',
      state: 'limited',
      limitation: 'The current property record does not establish an owner name.',
    })
  }

  if (parcel?.occupancy) {
    items.push({
      key: 'occupancy',
      label: 'Occupancy signal',
      value:
        parcel.occupancy === 'owner_occupied'
          ? 'Owner occupied'
          : parcel.occupancy === 'likely_absentee'
            ? 'Likely absentee'
            : 'Unknown',
      source: `Assessor signal · ${parcel.occupancyBasis.replaceAll('_', ' ')}`,
      state: parcel.occupancy === 'unknown' ? 'limited' : 'supported',
      limitation: 'Occupancy is an assessor-derived signal, not proof of who currently answers the door.',
    })
  }

  if (typeof parcel?.assessedValue === 'number') {
    items.push({
      key: 'value',
      label: 'Property value signal',
      value: money(parcel.assessedValue),
      source: `${parcel.parish} assessor`,
      state: 'supported',
      limitation: 'Assessed value is not market value and is used only as an opportunity-ranking input.',
    })
  }

  if (managed?.contactPhone) {
    const source = contactSourceOf(managed)
    const call = mayContact(managed, 'call')
    items.push({
      key: 'phone',
      label: 'Phone',
      value: managed.contactPhone,
      source: source ? source.replaceAll('_', ' ') : 'source not recorded',
      state:
        managed.optedOutAt || managed.status === 'do_not_knock'
          ? 'blocked'
          : source && isFromHomeowner(source) && call.allowed
            ? 'established'
            : 'limited',
      limitation: call.allowed
        ? 'Contact permission is recorded for calling.'
        : call.reason,
    })
  } else {
    items.push({
      key: 'phone',
      label: 'Phone',
      value: 'Not established',
      source: 'Contact record',
      state: 'limited',
      limitation: 'A property can be a strong opportunity without a usable homeowner contact.',
    })
  }

  for (const item of items) {
    if (item.limitation) limitations.push(item.limitation)
  }

  return {
    headline:
      managed?.status === 'appointment'
        ? 'Property evidence plus homeowner appointment'
        : managed?.status === 'need_visit'
          ? 'Property evidence plus homeowner inspection intent'
          : 'Property evidence behind this opportunity',
    items,
    limitations: [...new Set(limitations)],
  }
}
