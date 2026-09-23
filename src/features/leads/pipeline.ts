/**
 * What happens to a door after somebody knocks on it.
 *
 * A list of 150 addresses is a canvassing route, not a pipeline. The moment a
 * rep speaks to a person, that address stops being a row in a regenerated list
 * and becomes a record with a history that must survive the next refresh, the
 * next app update and going offline for a day. That promotion is the whole
 * point of this module.
 *
 * Everything here is pure so the rules can be tested without a database or a
 * browser. Persistence lives in lead-store.ts.
 */

import { newId } from '@/lib/db'

export type LeadStatus =
  /** On the list, never knocked. */
  | 'new'
  /** Knocked, nobody came to the door. */
  | 'attempted'
  /** Spoke to somebody who asked to be approached again later. */
  | 'follow_up'
  /** Wants a roof looked at. Nothing is booked yet. */
  | 'need_visit'
  /** A time was agreed. */
  | 'appointment'
  /** An inspection was captured against this address. */
  | 'inspected'
  | 'not_interested'
  /** Asked not to be called on again. Never appears on a door list. */
  | 'do_not_knock'

/**
 * What a rep taps standing in the driveway.
 *
 * Deliberately NOT a list of what happened to a phone call. The app cannot
 * know whether a call was answered, so it never offers that as an outcome.
 */
export type DoorOutcome =
  | 'no_answer'
  | 'come_back'
  | 'interested'
  | 'appointment_set'
  | 'inspect_now'
  | 'not_interested'
  | 'do_not_knock'

/**
 * How a contact was made. Each name says exactly what the app witnessed and
 * nothing more: a placed call is not an answered call, and an initiated text
 * is not a delivered text.
 */
export type ContactKind =
  | 'door_knock'
  | 'call_placed'
  | 'text_initiated'
  | 'note'
  | 'appointment_set'
  | 'inspection_started'

export const OUTCOME_LABEL: Record<DoorOutcome, string> = {
  no_answer: 'Not home',
  come_back: 'Come back later',
  interested: 'Interested',
  appointment_set: 'Appointment set',
  inspect_now: 'Inspecting now',
  not_interested: 'Not interested',
  do_not_knock: 'Do not knock',
}

export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  door_knock: 'Knocked',
  call_placed: 'Call placed',
  text_initiated: 'Text initiated',
  note: 'Note',
  appointment_set: 'Appointment set',
  inspection_started: 'Inspection started',
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  attempted: 'Not home',
  follow_up: 'Follow-up',
  need_visit: 'Needs a visit',
  appointment: 'Appointment',
  inspected: 'Inspected',
  not_interested: 'Not interested',
  do_not_knock: 'Do not knock',
}

export interface ManagedLead {
  id: string
  /** Same key the door list uses, so a refreshed run can recognise it. */
  addressKey: string
  address: string
  latitude: number
  longitude: number
  city?: string
  postalCode?: string
  subdivision?: string
  /** Priority at the moment it was promoted. Not recomputed afterwards. */
  score: number
  /** Why it was on the door list, frozen at promotion. */
  reasons: string[]
  status: LeadStatus
  /**
   * The office's own word for this lead, as it was last read from the server.
   *
   * The door sheet's vocabulary is narrower than the database's: there is no
   * button for 'sold' or 'proposal_pending' because those are decided after the
   * estimate, not in a driveway. Keeping the server's word here is what lets a
   * push refuse to write a display-level status back over a real one.
   */
  remoteStatus?: string
  createdAt: string
  updatedAt: string
  contactName?: string
  contactPhone?: string
  /** When to come back. ISO. */
  nextActionAt?: string
  /** An agreed time, which is a stronger claim than a follow-up. ISO. */
  appointmentAt?: string
  /**
   * Identity for the appointment row on the server: the id of the knock at
   * which it was agreed.
   *
   * Previously the appointment was pushed with `client_id = lead.id`, which
   * made "the appointment for this lead" a single row for all time. Moving a
   * time updated it, which is right — but setting a SECOND appointment months
   * later, after the first was kept, overwrote the record of the first. A
   * homeowner's history of agreed visits is not something the CRM should be
   * quietly collapsing.
   */
  appointmentClientId?: string
  /** Set once an inspection is started from this lead. */
  inspectionId?: string
  /** How many times someone has stood at this door. */
  knockCount: number
  /**
   * When this person said Delta Ridge could contact them on a channel, and
   * how that was established. Absent means they never said so — which is not
   * the same as no, and is also not permission.
   */
  consent?: Partial<Record<ContactChannel, ConsentRecord>>
  /**
   * When they asked to be left alone. Overrides every consent on the record,
   * permanently, on every channel.
   */
  optedOutAt?: string
}

export type ContactChannel = 'call' | 'sms' | 'email'

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  call: 'Phone call',
  sms: 'Text message',
  email: 'Email',
}

export interface ConsentRecord {
  at: string
  /**
   * Only one source exists today, and it is named rather than assumed. A
   * verbal yes at a door is what this app can actually witness; a written
   * opt-in collected through a form is a different, stronger thing, and when
   * one exists it must be distinguishable from this.
   */
  source: 'verbal_at_door'
}

export type ContactBlock =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Whether this person may be contacted on this channel.
 *
 * The default is NO. Consent is a thing somebody said, not a thing inferred
 * from having a phone number — and a number written on a door sheet is not
 * permission to text it. This is the gate every send has to pass, including
 * the one-at-a-time call and text buttons.
 */
export function mayContact(lead: ManagedLead, channel: ContactChannel): ContactBlock {
  if (lead.optedOutAt !== undefined) {
    return { allowed: false, reason: 'They asked not to be contacted.' }
  }
  if (lead.status === 'do_not_knock') {
    return { allowed: false, reason: 'Marked do not knock.' }
  }
  if (channel !== 'email' && lead.contactPhone === undefined) {
    return { allowed: false, reason: 'No phone number on this lead.' }
  }
  if (lead.consent?.[channel] === undefined) {
    return {
      allowed: false,
      reason: `No recorded permission to ${channel === 'call' ? 'call' : channel === 'sms' ? 'text' : 'email'} them.`,
    }
  }
  return { allowed: true }
}

/** Records permission, or withdraws it. Never mutates the lead it was given. */
export function setConsent(
  lead: ManagedLead,
  channel: ContactChannel,
  granted: boolean,
  at: string,
): ManagedLead {
  const consent = { ...(lead.consent ?? {}) }
  if (granted) consent[channel] = { at, source: 'verbal_at_door' }
  else delete consent[channel]

  const next: ManagedLead = { ...lead, updatedAt: at }
  if (Object.keys(consent).length > 0) next.consent = consent
  else delete next.consent
  return next
}

/**
 * Records that somebody asked to be left alone.
 *
 * Every consent on the record is cleared at the same time. Leaving them in
 * place would mean an opt-out that could be undone by a later edit, which is
 * the mechanism by which a suppression list quietly stops working.
 */
export function optOut(lead: ManagedLead, at: string): ManagedLead {
  const next: ManagedLead = { ...lead, optedOutAt: at, updatedAt: at }
  delete next.consent
  return next
}

export interface ConsentTally {
  readonly total: number
  readonly call: number
  readonly sms: number
  readonly email: number
  readonly optedOut: number
  readonly reachableSomehow: number
}

/** What the pipeline actually has permission for, for the readiness panel. */
export function consentTally(leads: readonly ManagedLead[]): ConsentTally {
  let call = 0
  let sms = 0
  let email = 0
  let optedOut = 0
  let reachable = 0

  for (const lead of leads) {
    if (lead.optedOutAt !== undefined) optedOut += 1
    const c = mayContact(lead, 'call').allowed
    const s = mayContact(lead, 'sms').allowed
    const e = mayContact(lead, 'email').allowed
    if (c) call += 1
    if (s) sms += 1
    if (e) email += 1
    if (c || s || e) reachable += 1
  }

  return { total: leads.length, call, sms, email, optedOut, reachableSomehow: reachable }
}

/**
 * How well the phone's own position matched the door, at the moment of the
 * knock.
 *
 * Structural rather than imported from the routes feature, so the pipeline —
 * which every screen depends on — does not gain a dependency on GPS code. The
 * classification itself lives in `features/routes/verification`.
 *
 * Stored on the event and never recomputed. A parcel centroid can be corrected
 * later and a phone's accuracy cannot be recovered at all, so re-deriving this
 * months afterwards would silently change the record of what was known at the
 * time.
 */
export interface KnockVerificationRecord {
  verification: 'verified' | 'probable' | 'unverified' | 'gps_unavailable'
  /** Centre-to-centre metres. Absent when there was no fix. */
  distanceMeters?: number
  /** The device's own accuracy estimate, in metres. */
  accuracyMeters?: number
}

export interface ContactEvent {
  id: string
  leadId: string
  at: string
  kind: ContactKind
  outcome?: DoorOutcome
  note?: string
  /** Absent on events that are not a visit — a call, a note typed at a desk. */
  gps?: KnockVerificationRecord
}

interface OutcomeRule {
  status: LeadStatus
  /** Days until the rep should come back. Absent means no follow-up. */
  followUpDays?: number
  /** Counts as somebody having stood at the door. */
  knock: boolean
}

/**
 * The follow-up intervals are deliberately short and hand-set. They are a
 * default the rep can change, not a prediction — there is no outcome history
 * in this system yet to learn a cadence from.
 */
const RULES: Record<DoorOutcome, OutcomeRule> = {
  no_answer: { status: 'attempted', followUpDays: 2, knock: true },
  come_back: { status: 'follow_up', followUpDays: 3, knock: true },
  interested: { status: 'need_visit', followUpDays: 1, knock: true },
  appointment_set: { status: 'appointment', knock: true },
  inspect_now: { status: 'inspected', knock: true },
  not_interested: { status: 'not_interested', knock: true },
  do_not_knock: { status: 'do_not_knock', knock: false },
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export interface ApplyOptions {
  note?: string
  /** Required for appointment_set; ignored otherwise. */
  appointmentAt?: string
  /** Overrides the default follow-up interval. */
  followUpAt?: string
  inspectionId?: string
  /** Captured at the door, when somebody actually came to it. */
  contactName?: string
  contactPhone?: string
  /** What the phone could say about being at this property, if anything. */
  gps?: KnockVerificationRecord
}

/**
 * Records an outcome against a lead.
 *
 * Returns a NEW lead and the event that justifies the change, never mutating
 * the input, so the caller can write both in one transaction or neither.
 */
export function applyOutcome(
  lead: ManagedLead,
  outcome: DoorOutcome,
  at: string,
  options: ApplyOptions = {},
): { lead: ManagedLead; event: ContactEvent } {
  const rule = RULES[outcome]

  // Generated up front because two things need it: the event itself, and the
  // appointment that event may have agreed.
  const eventId = newId()

  const nextActionAt =
    options.followUpAt ??
    (rule.followUpDays !== undefined ? addDays(at, rule.followUpDays) : undefined)

  const next: ManagedLead = {
    ...lead,
    status: rule.status,
    updatedAt: at,
    knockCount: lead.knockCount + (rule.knock ? 1 : 0),
  }

  // exactOptionalPropertyTypes: a cleared field is deleted, never set to
  // undefined, so a saved record never carries a key that means nothing.
  if (nextActionAt !== undefined) next.nextActionAt = nextActionAt
  else delete next.nextActionAt

  if (outcome === 'appointment_set' && options.appointmentAt !== undefined) {
    next.appointmentAt = options.appointmentAt
    next.nextActionAt = options.appointmentAt
    // A new agreement gets a new identity; moving an existing one does not,
    // because the caller passes the same lead through without a fresh
    // appointment_set outcome.
    next.appointmentClientId = eventId
  }
  if (outcome === 'do_not_knock' || outcome === 'not_interested') {
    delete next.appointmentAt
    delete next.appointmentClientId
  }
  if (options.inspectionId !== undefined) next.inspectionId = options.inspectionId
  // A name learned at the door is kept; a blank field never erases one.
  if (options.contactName !== undefined && options.contactName !== '') {
    next.contactName = options.contactName
  }
  if (options.contactPhone !== undefined && options.contactPhone !== '') {
    next.contactPhone = options.contactPhone
  }

  // A UUID, not a composite of the lead id and the clock. Two things depend on
  // it: the server stores it in a uuid column as the conflict target for an
  // idempotent push, and two knocks at the same address are genuinely two
  // events that must both survive.
  const event: ContactEvent = {
    id: eventId,
    leadId: lead.id,
    at,
    kind: outcome === 'appointment_set' ? 'appointment_set' : 'door_knock',
    outcome,
    ...(options.note !== undefined && options.note !== '' ? { note: options.note } : {}),
    ...(options.gps !== undefined ? { gps: options.gps } : {}),
  }

  return { lead: next, event }
}

export interface ChipCounts {
  readonly newDoors: number
  readonly followUp: number
  readonly needVisit: number
  readonly appointments: number
}

/**
 * The four numbers across the top.
 *
 * FOLLOW-UP deliberately folds "not home" in with "come back later": from the
 * rep's point of view both mean the same thing — that door is owed another
 * visit — and splitting them would make the number smaller than the work.
 */
export function chipCounts(leads: readonly ManagedLead[], newDoors: number): ChipCounts {
  let followUp = 0
  let needVisit = 0
  let appointments = 0

  for (const lead of leads) {
    if (lead.status === 'attempted' || lead.status === 'follow_up') followUp += 1
    else if (lead.status === 'need_visit') needVisit += 1
    else if (lead.status === 'appointment') appointments += 1
  }

  return { newDoors, followUp, needVisit, appointments }
}

/** A lead whose next action has come due. */
export function isDue(lead: ManagedLead, now: string): boolean {
  return lead.nextActionAt !== undefined && lead.nextActionAt <= now
}

/** Doors a rep should not be shown again. */
export function isSuppressed(lead: ManagedLead): boolean {
  return lead.status === 'do_not_knock' || lead.status === 'not_interested'
}

/**
 * Working order: what is due first, then what is coming, then everything else,
 * with the higher-priority door first inside each band.
 */
export function sortForField(leads: readonly ManagedLead[], now: string): ManagedLead[] {
  const band = (l: ManagedLead): number => {
    if (l.status === 'appointment') return 0
    if (isDue(l, now)) return 1
    if (l.nextActionAt !== undefined) return 2
    return 3
  }
  return [...leads].sort((a, b) => {
    const byBand = band(a) - band(b)
    if (byBand !== 0) return byBand
    const aAt = a.nextActionAt ?? ''
    const bAt = b.nextActionAt ?? ''
    if (aAt !== bAt) return aAt.localeCompare(bAt)
    return b.score - a.score
  })
}

/** Human wording for when a lead is next owed something. */
export function dueLabel(lead: ManagedLead, now: string): string | null {
  const at = lead.appointmentAt ?? lead.nextActionAt
  if (at === undefined) return null

  const days = Math.round(
    (new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000,
  )
  const when =
    days < -1 ? `${Math.abs(days)} days overdue` : days === -1 ? 'yesterday' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`

  return lead.appointmentAt !== undefined ? `Appointment ${when}` : `Back ${when}`
}
