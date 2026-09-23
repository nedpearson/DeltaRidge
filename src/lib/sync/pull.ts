import { normalizeAddress } from '@/lib/address'
import {
  readLead,
  saveEventFromServer,
  saveLeadFromServer,
} from '@/features/leads/lead-store'
import type {
  ContactEvent,
  ContactKind,
  DoorOutcome,
  LeadStatus,
  ManagedLead,
} from '@/features/leads/pipeline'
import { getSupabase } from '../supabase'
import { listOutbox } from '../sync-store'
import { setRemoteId } from '../sync-store'

/**
 * Reading the server back.
 *
 * There was no pull path at all before this. Every `.select()` in the sync
 * layer was a `returning id` after a write, which meant the server was a
 * write-only archive: a second rep could not see the street a colleague had
 * already walked, a manager's device showed nothing, and a lost phone was a
 * lost pipeline no matter how well the push worked.
 *
 * Three rules govern what this is allowed to do to the device:
 *
 *   1. A lead the device has never seen is inserted. That is the whole point.
 *   2. A lead the device HAS seen, with nothing queued for it, is refreshed
 *      only when the server's row is genuinely newer.
 *   3. A lead with unsent local work is never touched. The rep's knock has not
 *      reached the server yet, so the server's row is by definition the older
 *      story. Those are reported as conflicts rather than resolved silently.
 */

export interface PullResult {
  inserted: number
  updated: number
  /** Leads left alone because the device is still holding unsent work for them. */
  heldBack: number
  activities: number
  errors: string[]
  skipped: 'offline' | 'no-session' | 'no-membership' | null
}

/**
 * The office vocabulary is wider than the door sheet's, so this is lossy on
 * purpose and in one direction only.
 *
 * `sold`, `lost`, `proposal_pending` and `existing_customer` are outcomes the
 * rep cannot set from a driveway — they are decided after the estimate. They
 * are mapped to the nearest thing a door sheet can display so the rep is not
 * shown a blank status, and `remoteStatus` below is what stops that display
 * value from ever being pushed back over the real one.
 */
export function localLeadStatus(remote: string): LeadStatus {
  switch (remote) {
    case 'untouched':
    case 'target':
      return 'new'
    case 'attempted':
    case 'no_answer':
      return 'attempted'
    case 'spoke':
    case 'interested':
      return 'follow_up'
    case 'inspection_requested':
      return 'need_visit'
    case 'appointment':
      return 'appointment'
    case 'inspected':
    case 'proposal_pending':
    case 'sold':
      return 'inspected'
    case 'lost':
    case 'not_interested':
      return 'not_interested'
    case 'do_not_contact':
      return 'do_not_knock'
    default:
      // An enum value added by a later migration that this build predates.
      // 'new' is the only safe landing place: it claims nothing happened rather
      // than inventing an outcome.
      return 'new'
  }
}

/** Office statuses the door sheet must never overwrite. See `pushLead`. */
export const TERMINAL_REMOTE_STATUSES = new Set([
  'sold',
  'lost',
  'proposal_pending',
  'existing_customer',
])

/**
 * `activities.outcome` is a free-text column. Anything the office or a future
 * integration wrote there that the door sheet does not recognise is dropped
 * rather than cast: a bad value would sit in the history looking like a real
 * outcome and drive the status rules off a word that means nothing here.
 */
const DOOR_OUTCOMES = new Set<string>([
  'no_answer',
  'come_back',
  'interested',
  'appointment_set',
  'inspect_now',
  'not_interested',
  'do_not_knock',
])

export function asDoorOutcome(value: string | null): DoorOutcome | null {
  return value && DOOR_OUTCOMES.has(value) ? (value as DoorOutcome) : null
}

export function localContactKind(activityType: string): ContactKind {
  switch (activityType) {
    case 'door_knock':
      return 'door_knock'
    case 'call':
      return 'call_placed'
    case 'text':
      return 'text_initiated'
    case 'appointment':
      return 'appointment_set'
    case 'inspection':
      return 'inspection_started'
    default:
      return 'note'
  }
}

interface LeadRow {
  remote_id: string
  client_id: string
  status: string
  opportunity_score: number | null
  next_action_at: string | null
  next_action_note: string | null
  first_contacted_at: string | null
  last_activity_at: string | null
  created_at: string
  updated_at: string
  address_line1: string
  city: string | null
  postal_code: string | null
  latitude: number | null
  longitude: number | null
  contact_name: string | null
  contact_phone: string | null
}

interface ActivityRow {
  remote_id: string
  client_id: string
  lead_client_id: string
  activity_type: string
  outcome: string | null
  body: string | null
  occurred_at: string
}

/**
 * Local ids of leads with anything still queued.
 *
 * Read once per pull rather than per row: a device coming back from a day
 * offline can easily have a few hundred queued items, and asking the queue
 * about each of two hundred leads separately turns a pull into a stall.
 */
async function leadsWithUnsentWork(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const item of await listOutbox()) {
    if (item.entity === 'lead') out.add(item.entityId)
  }
  return out
}

function toManagedLead(row: LeadRow, existing: ManagedLead | null): ManagedLead {
  const addressKey = normalizeAddress(row.address_line1) ?? row.address_line1.toLowerCase()
  const lead: ManagedLead = {
    // The device's own id for this lead IS the client_id. That is what makes
    // the pull idempotent and what lets two devices converge on one row.
    id: row.client_id,
    addressKey,
    address: row.address_line1,
    latitude: row.latitude ?? existing?.latitude ?? 0,
    longitude: row.longitude ?? existing?.longitude ?? 0,
    score: row.opportunity_score ?? existing?.score ?? 0,
    // Not carried on the server as a list. Whatever the device already had is
    // better than an empty array, and an empty array is better than inventing
    // reasons this lead was worth knocking.
    reasons: existing?.reasons ?? [],
    status: localLeadStatus(row.status),
    remoteStatus: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    knockCount: existing?.knockCount ?? (row.first_contacted_at ? 1 : 0),
  }
  if (row.city) lead.city = row.city
  if (row.postal_code) lead.postalCode = row.postal_code
  if (row.contact_name) lead.contactName = row.contact_name
  if (row.contact_phone) lead.contactPhone = row.contact_phone
  if (row.next_action_at) lead.nextActionAt = row.next_action_at
  // Consent and opt-out live only on the device today. Dropping them on a pull
  // would quietly re-open a channel someone asked to be left off, so whatever
  // the device holds is kept regardless of what the server row says.
  if (existing?.consent) lead.consent = existing.consent
  if (existing?.optedOutAt) lead.optedOutAt = existing.optedOutAt
  if (existing?.subdivision) lead.subdivision = existing.subdivision
  if (existing?.inspectionId) lead.inspectionId = existing.inspectionId
  if (existing?.appointmentAt) lead.appointmentAt = existing.appointmentAt
  return lead
}

export async function pullLeads(orgId: string | null, userId: string | null): Promise<PullResult> {
  const result: PullResult = {
    inserted: 0,
    updated: 0,
    heldBack: 0,
    activities: 0,
    errors: [],
    skipped: null,
  }

  if (!navigator.onLine) return { ...result, skipped: 'offline' }
  const supabase = getSupabase()
  if (!userId || !supabase) return { ...result, skipped: 'no-session' }
  if (!orgId) return { ...result, skipped: 'no-membership' }

  const { data, error } = await supabase
    .from('lead_sync_rows')
    .select('*')
    .eq('organization_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(2000)

  if (error) {
    result.errors.push(`leads: ${error.message}`)
    return result
  }

  const unsent = await leadsWithUnsentWork()
  const rows = (data ?? []) as LeadRow[]
  const accepted: string[] = []

  for (const row of rows) {
    try {
      // Recorded whatever happens next: knowing the server id for a lead this
      // device already has is what turns the next push into an update instead
      // of a duplicate insert.
      await setRemoteId('lead', row.client_id, row.remote_id)

      const existing = await readLead(row.client_id)
      if (existing && unsent.has(row.client_id)) {
        result.heldBack += 1
        continue
      }
      if (existing && new Date(row.updated_at).getTime() <= new Date(existing.updatedAt).getTime()) {
        accepted.push(row.client_id)
        continue
      }

      await saveLeadFromServer(toManagedLead(row, existing))
      accepted.push(row.client_id)
      if (existing) result.updated += 1
      else result.inserted += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (result.errors.length < 5) result.errors.push(`lead ${row.address_line1}: ${message}`)
    }
  }

  result.activities = await pullActivities(orgId, accepted, result.errors)
  return result
}

/**
 * Knocks for the leads this pull accepted.
 *
 * Only for those: filing an activity against a lead the device chose not to
 * take would leave a history entry pointing at nothing, which reads on screen
 * as a knock that happened at no address.
 */
async function pullActivities(
  orgId: string,
  leadClientIds: string[],
  errors: string[],
): Promise<number> {
  const supabase = getSupabase()
  if (!supabase || leadClientIds.length === 0) return 0

  let written = 0
  // Chunked because the id list goes into the URL. A rep's device can easily
  // hold a thousand leads, and a single `in.()` of that size is a request no
  // proxy will accept.
  const CHUNK = 100
  for (let i = 0; i < leadClientIds.length; i += CHUNK) {
    const chunk = leadClientIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('activity_sync_rows')
      .select('*')
      .eq('organization_id', orgId)
      .in('lead_client_id', chunk)
      .order('occurred_at', { ascending: false })
      .limit(5000)

    if (error) {
      if (errors.length < 5) errors.push(`activities: ${error.message}`)
      continue
    }

    for (const row of (data ?? []) as ActivityRow[]) {
      const event: ContactEvent = {
        id: row.client_id,
        leadId: row.lead_client_id,
        at: row.occurred_at,
        kind: localContactKind(row.activity_type),
      }
      const outcome = asDoorOutcome(row.outcome)
      if (outcome) event.outcome = outcome
      if (row.body) event.note = row.body
      try {
        await saveEventFromServer(event)
        await setRemoteId('leadActivity', row.client_id, row.remote_id)
        written += 1
      } catch {
        // One unreadable row must not abandon the rest of the day's history.
      }
    }
  }
  return written
}
