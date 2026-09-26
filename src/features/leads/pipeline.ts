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
  /**
   * Not a prospect, and not because of anything the homeowner decided: the roof
   * is already new, the lot is empty, the building is gone. Held apart from
   * 'not_interested' because a rep who turns up twenty of these has been given
   * a bad list, which is a different problem from a rep who is being turned
   * down at the door.
   */
  | 'disqualified'
  /** Asked not to be called on again. Never appears on a door list. */
  | 'do_not_knock'

/**
 * What a rep taps standing in the driveway.
 *
 * Deliberately NOT a list of what happened to a phone call. The app cannot
 * know whether a call was answered, so it never offers that as an outcome.
 */
export type DoorOutcome =
  /** Knocked, nobody came. */
  | 'no_answer'
  /** Somebody came to the door and there was a conversation. Nothing agreed. */
  | 'spoke'
  /** Door hanger, card, estimate sheet. Whether anyone answered is separate. */
  | 'left_info'
  | 'come_back'
  | 'interested'
  /** Asked, in so many words, to have the roof looked at. Stronger than interested. */
  | 'wants_inspection'
  | 'appointment_set'
  | 'inspect_now'
  | 'not_interested'
  /** Already re-roofed. Not a prospect, and not a rejection. */
  | 'roof_replaced'
  /** Whoever answered does not own it. The door is not the decision. */
  | 'renter'
  /** Nobody lives here. Empty, derelict, or the house is gone. */
  | 'vacant'
  | 'do_not_knock'
  /** None of the above. The note carries it. */
  | 'other'

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
  spoke: 'Spoke to owner',
  left_info: 'Left information',
  come_back: 'Come back later',
  interested: 'Interested',
  wants_inspection: 'Wants inspection',
  appointment_set: 'Appointment set',
  inspect_now: 'Inspecting now',
  not_interested: 'Not interested',
  roof_replaced: 'Roof already replaced',
  renter: 'Renter, not the owner',
  vacant: 'Vacant',
  do_not_knock: 'Do not knock',
  other: 'Something else',
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
  disqualified: 'Not a prospect',
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
  contactEmail?: string
  /**
   * Where the phone number came from. See `ContactSource`.
   *
   * Absent on a record written before this field existed. Those are treated as
   * `homeowner_at_door`, because the door sheet was the only code path that
   * could set a number at all — not because absent means trustworthy.
   */
  contactSource?: ContactSource
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

/**
 * Where a phone number came from.
 *
 * This exists because a number the homeowner said out loud and a number off a
 * records lookup were indistinguishable on the record, and that distinction is
 * the whole question if the call is ever challenged. "We had their number" is
 * not an answer; "she gave it to me at the door on the 12th" is.
 *
 * It is not a quality score. A looked-up number may well be correct. It is a
 * statement about whether this person handed it over, which is a different
 * fact and the one the TCPA cares about.
 */
export type ContactSource =
  /** They said it, standing at their door. */
  | 'homeowner_at_door'
  /** They said it on a call they placed or returned. */
  | 'homeowner_by_phone'
  /** They wrote it — a form, a signed agreement, an email they sent. */
  | 'homeowner_in_writing'
  /** The parish roll or another public record. Not something they gave us. */
  | 'public_record'
  /** A people-search or skip-trace service. Not something they gave us. */
  | 'third_party_lookup'
  /** Nobody recorded where it came from. Treated as not from them. */
  | 'unknown'

export const CONTACT_SOURCE_LABEL: Record<ContactSource, string> = {
  homeowner_at_door: 'They gave it at the door',
  homeowner_by_phone: 'They gave it on a call',
  homeowner_in_writing: 'They wrote it down',
  public_record: 'Public record',
  third_party_lookup: 'Records lookup',
  unknown: 'Source not recorded',
}

/**
 * Sources that are the homeowner handing over their own number.
 *
 * Everything else is somebody else telling us about them, however accurate.
 */
const FROM_THE_HOMEOWNER = new Set<ContactSource>([
  'homeowner_at_door',
  'homeowner_by_phone',
  'homeowner_in_writing',
])

export function contactSourceOf(lead: ManagedLead): ContactSource | null {
  if (lead.contactPhone === undefined) return null
  // A record written before this field existed can only have come from the door
  // sheet, which is the one place that ever set a number. Stated here so the
  // assumption is arguable rather than silent.
  return lead.contactSource ?? 'homeowner_at_door'
}

export function isFromHomeowner(source: ContactSource): boolean {
  return FROM_THE_HOMEOWNER.has(source)
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
  // Consent recorded against a number the homeowner never handed over is not
  // consent from the person who answers it. A looked-up number may be perfectly
  // correct and still belong to somebody who never spoke to us.
  if (channel !== 'email') {
    const source = contactSourceOf(lead)
    if (source !== null && !isFromHomeowner(source)) {
      return {
        allowed: false,
        reason:
          source === 'third_party_lookup'
            ? 'This number came from a records lookup, not from them. Confirm it at the door and record it before calling.'
            : source === 'public_record'
              ? 'This number came from a public record, not from them. Confirm it at the door and record it before calling.'
              : 'Nobody recorded where this number came from. Confirm it at the door before calling.',
      }
    }
  }
  if (lead.consent?.[channel] === undefined) {
    return {
      allowed: false,
      reason: `No recorded permission to ${channel === 'call' ? 'call' : channel === 'sms' ? 'text' : 'email'} them.`,
    }
  }
  return { allowed: true }
}

/**
 * Records a name and number, with where they came from.
 *
 * The source is required. There is deliberately no overload that omits it: the
 * whole point is that a number cannot enter the record without somebody saying
 * how it got there, and an optional field would be blank on exactly the rows
 * where it matters most.
 *
 * Changing the number resets any consent on the phone channels. Permission to
 * call was permission to call THAT number; carrying it across to a different
 * one is how a consent record stops meaning anything.
 */
export function setContact(
  lead: ManagedLead,
  details: { name?: string; phone?: string; source: ContactSource },
  at: string,
): ManagedLead {
  const next: ManagedLead = { ...lead, updatedAt: at }

  if (details.name !== undefined && details.name !== '') next.contactName = details.name

  if (details.phone !== undefined && details.phone !== '') {
    const changed = lead.contactPhone !== details.phone
    next.contactPhone = details.phone
    next.contactSource = details.source
    if (changed && lead.consent) {
      const consent = { ...lead.consent }
      delete consent.call
      delete consent.sms
      if (Object.keys(consent).length > 0) next.consent = consent
      else delete next.consent
    }
  }

  return next
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
  /**
   * The route that was running when this was recorded.
   *
   * Stamped once, at the moment of capture, from the open session. Absent means
   * no route was running, which is an ordinary thing — a phone call from the
   * truck, a follow-up typed at a desk — and never something to repair later by
   * matching timestamps against sessions. That guess is what this field exists
   * to replace: it is wrong for an activity synced hours after a dead spot, and
   * wrong for every activity on a day the rep forgot to end their route.
   */
  routeSessionId?: string
}

interface OutcomeRule {
  status: LeadStatus
  /** Days until the rep should come back. Absent means no follow-up. */
  followUpDays?: number
  /** Counts as somebody having stood at the door. */
  knock: boolean
  /**
   * Counts as a human being having engaged.
   *
   * Stated per outcome rather than derived from `outcome !== 'no_answer'`,
   * which is what the manager roll-up used to do and which quietly counted a
   * door hanger, an empty lot and a finished roof as conversations. Contact
   * rate is a load-bearing number in every performance screen downstream, so
   * what does and does not count is written down here where it can be argued
   * with.
   */
  conversation: boolean
}

/**
 * The follow-up intervals are deliberately short and hand-set. They are a
 * default the rep can change, not a prediction — there is no outcome history
 * in this system yet to learn a cadence from.
 */
const RULES: Record<DoorOutcome, OutcomeRule> = {
  no_answer: { status: 'attempted', followUpDays: 2, knock: true, conversation: false },
  spoke: { status: 'follow_up', followUpDays: 3, knock: true, conversation: true },
  // Left information is recorded as a knock and NOT as a conversation. A door
  // hanger is not a person; counting it as contact would inflate the one number
  // the whole grading engine leans on.
  left_info: { status: 'attempted', followUpDays: 3, knock: true, conversation: false },
  come_back: { status: 'follow_up', followUpDays: 3, knock: true, conversation: true },
  interested: { status: 'need_visit', followUpDays: 1, knock: true, conversation: true },
  wants_inspection: { status: 'need_visit', followUpDays: 1, knock: true, conversation: true },
  appointment_set: { status: 'appointment', knock: true, conversation: true },
  inspect_now: { status: 'inspected', knock: true, conversation: true },
  not_interested: { status: 'not_interested', knock: true, conversation: true },
  // Disqualifying outcomes. Someone answered in the renter case, so it counts
  // as a conversation; an empty house and a finished roof do not.
  roof_replaced: { status: 'disqualified', knock: true, conversation: false },
  renter: { status: 'follow_up', followUpDays: 14, knock: true, conversation: true },
  vacant: { status: 'disqualified', knock: true, conversation: false },
  do_not_knock: { status: 'do_not_knock', knock: false, conversation: false },
  // Deliberately conservative: the app does not know what happened, so it does
  // not claim a conversation took place.
  other: { status: 'attempted', followUpDays: 2, knock: true, conversation: false },
}

/**
 * Every outcome this build understands, as a runtime set.
 *
 * The type alone cannot filter a string that arrived from the server, and a
 * word this build does not recognise must be dropped rather than cast: it would
 * otherwise sit in the history looking like a real outcome and drive both the
 * status rules and a rep's contact rate off a value that means nothing here.
 */
export const DOOR_OUTCOMES: ReadonlySet<string> = new Set(Object.keys(RULES))

export function asDoorOutcome(value: string | null | undefined): DoorOutcome | null {
  return value && DOOR_OUTCOMES.has(value) ? (value as DoorOutcome) : null
}

/**
 * Did a person engage at this door?
 *
 * The single definition, exported so the manager roll-ups and the grading
 * engine cannot drift from the door sheet. Contact rate is quoted in
 * performance reviews; two files disagreeing about what counts is how a rep
 * ends up defending a number nobody can reproduce.
 */
export function isConversation(outcome: DoorOutcome): boolean {
  return RULES[outcome].conversation
}

/** Outcomes that mean somebody stood at the door. */
export function isKnock(outcome: DoorOutcome): boolean {
  return RULES[outcome].knock
}

/** The outcomes that take a door off the list without anybody rejecting an offer. */
export function isDisqualifying(outcome: DoorOutcome): boolean {
  return RULES[outcome].status === 'disqualified'
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
  /** The open route, if one is running. See ContactEvent.routeSessionId. */
  routeSessionId?: string
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
  if (
    outcome === 'do_not_knock' ||
    outcome === 'not_interested' ||
    outcome === 'roof_replaced' ||
    outcome === 'vacant'
  ) {
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
    // The door sheet knows its own provenance: somebody standing at the door
    // said this. Nothing else in this function has to guess.
    next.contactSource = 'homeowner_at_door'
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
    // Stamped here, at capture, or not at all. Recording it later from the
    // clock is the guess this replaces.
    ...(options.routeSessionId !== undefined
      ? { routeSessionId: options.routeSessionId }
      : {}),
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
