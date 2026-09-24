/**
 * Deciding whether a lead is allowed into Roofr, and what to say about it.
 *
 * Pure, so the decisions are testable without a network. Every refusal below is
 * a deliberate one: the cost of pushing a lead that should not go is a junk
 * record in the CRM the office actually works out of, and the cost of pushing
 * one with invented details is worse than that.
 */

/** Delta Ridge lead statuses, in the order a door actually progresses. */
export const STATUS_ORDER = [
  'untouched',
  'target',
  'attempted',
  'no_answer',
  'spoke',
  'interested',
  'inspection_requested',
  'appointment',
  'inspected',
  'proposal_pending',
  'sold',
] as const

export type PushThreshold =
  | 'manual_only'
  | 'lead_created'
  | 'contacted'
  | 'interested'
  | 'inspection_scheduled'
  | 'manager_approved'

/**
 * Where each threshold sits on that ladder.
 *
 * `manager_approved` and `manual_only` are deliberately unreachable by rank:
 * they mean a person decides, and no status alone satisfies them.
 */
const THRESHOLD_STATUS: Readonly<Record<PushThreshold, string | null>> = {
  manual_only: null,
  manager_approved: null,
  lead_created: 'target',
  contacted: 'spoke',
  interested: 'interested',
  inspection_scheduled: 'appointment',
}

export function statusRank(status: string): number {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number])
  return index
}

export interface PushCandidate {
  readonly leadId: string
  readonly status: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly companyName: string | null
  readonly email: string | null
  readonly phone: string | null
  /** Where the phone number came from. Governs whether it travels. */
  readonly phoneSource: string | null
  readonly addressLine1: string | null
  readonly city: string | null
  readonly state: string | null
  readonly postalCode: string | null
  readonly alreadyLinked: boolean
}

export interface PushSettings {
  readonly pushEnabled: boolean
  readonly threshold: PushThreshold
}

export type Eligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/**
 * A number the homeowner gave us travels. A number we looked up does not.
 *
 * Delta Ridge already refuses to dial a number whose provenance is a third-party
 * lookup or a public record. Copying that number into Roofr would put it in
 * front of an office that has none of that context and a click-to-call button,
 * which launders the restriction rather than respecting it.
 */
const FROM_THE_HOMEOWNER = new Set([
  'homeowner_at_door',
  'homeowner_by_phone',
  'homeowner_in_writing',
])

export function phoneMayTravel(source: string | null): boolean {
  return source !== null && FROM_THE_HOMEOWNER.has(source)
}

export function eligibility(lead: PushCandidate, settings: PushSettings): Eligibility {
  if (!settings.pushEnabled) {
    return { ok: false, reason: 'the Roofr connection is not switched on yet' }
  }
  if (lead.alreadyLinked) {
    return { ok: false, reason: 'this lead is already in Roofr' }
  }
  if (lead.addressLine1 === null || lead.addressLine1.trim() === '') {
    return { ok: false, reason: 'no property address to send' }
  }

  // Roofr's create action makes a CUSTOMER as well as a job, and a customer with
  // no name is a record nobody in the office can work. We will not invent one
  // from the address.
  const hasName =
    (lead.firstName ?? '').trim() !== '' ||
    (lead.lastName ?? '').trim() !== '' ||
    (lead.companyName ?? '').trim() !== ''
  if (!hasName) {
    return { ok: false, reason: 'no homeowner name on this lead, and one is not invented' }
  }

  if (['lost', 'not_interested', 'do_not_contact'].includes(lead.status)) {
    return { ok: false, reason: `a lead marked ${lead.status} is not sent to Roofr` }
  }

  const required = THRESHOLD_STATUS[settings.threshold]
  if (required === null) {
    // manual_only / manager_approved: a person is the gate, and this function is
    // only ever reached because a person asked. Nothing further to check.
    return { ok: true }
  }
  if (statusRank(lead.status) < statusRank(required)) {
    return {
      ok: false,
      reason: `this lead is at ${lead.status}; the company sends leads to Roofr from ${required} onward`,
    }
  }
  return { ok: true }
}

/**
 * The id we issue so a retry cannot make a second job.
 *
 * Derived from the lead, not random, so the same lead always produces the same
 * external id no matter how many times the button is pressed or how many times
 * the POST is retried after a timeout whose outcome we never learned.
 */
export function externalJobId(leadId: string): string {
  return `dr-${leadId}`
}

export interface JobPayload {
  readonly external_job_id: string
  readonly customer: {
    readonly first_name: string | null
    readonly last_name: string | null
    readonly company_name: string | null
    readonly email: string | null
    readonly phone: string | null
  }
  readonly address: {
    readonly line1: string
    readonly city: string | null
    readonly state: string | null
    readonly postal_code: string | null
  }
  readonly job_name: string
  readonly source: 'delta_ridge'
}

export function buildJobPayload(lead: PushCandidate): JobPayload {
  const line1 = (lead.addressLine1 ?? '').trim()
  const who = [lead.firstName, lead.lastName].filter((p) => (p ?? '').trim() !== '').join(' ')
  const label = who !== '' ? who : (lead.companyName ?? '').trim()

  return {
    external_job_id: externalJobId(lead.leadId),
    customer: {
      first_name: nullIfBlank(lead.firstName),
      last_name: nullIfBlank(lead.lastName),
      company_name: nullIfBlank(lead.companyName),
      email: nullIfBlank(lead.email),
      // Withheld, not blanked by accident. See phoneMayTravel.
      phone: phoneMayTravel(lead.phoneSource) ? nullIfBlank(lead.phone) : null,
    },
    address: {
      line1,
      city: nullIfBlank(lead.city),
      state: nullIfBlank(lead.state),
      postal_code: nullIfBlank(lead.postalCode),
    },
    job_name: `${label} - ${line1}`,
    source: 'delta_ridge',
  }
}

function nullIfBlank(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
