import { readAttachment, readEvent, readLead } from '@/features/leads/lead-store'
import type { ContactKind, LeadStatus, ManagedLead } from '@/features/leads/pipeline'
import { getSupabase } from '../supabase'
import { getRemoteId, setRemoteId } from '../sync-store'
import { TERMINAL_REMOTE_STATUSES } from './pull'
import { ensurePropertyFor, pointOrNull } from './resolve'

/**
 * Pushing the pipeline to the office.
 *
 * Until this existed a lead lived on the phone that captured it, which made a
 * lost or wiped device a lost pipeline. It also made a second rep impossible:
 * two people cannot work a street if neither can see what the other knocked.
 *
 * Every push is an UPSERT keyed on (organization_id, client_id). A lead's
 * whole value is that its status MOVES, so pushing once on creation would
 * leave the office looking at a lead that is permanently "attempted" while the
 * rep has since booked, inspected and sold it.
 */

const UNIQUE_VIOLATION = '23505'

/**
 * Local status to the database's `lead_status` enum.
 *
 * The two vocabularies differ on purpose. The local one is what a rep taps in
 * a driveway; the database one predates it and is what the office reports on.
 * Mapping explicitly — rather than making the rep learn the office's words —
 * is what keeps the door sheet to six buttons.
 */
export function remoteLeadStatus(status: LeadStatus): string {
  switch (status) {
    // Promoted but no outcome recorded yet: it is a target, not an attempt.
    case 'new':
      return 'target'
    case 'attempted':
      return 'no_answer'
    case 'follow_up':
      return 'spoke'
    case 'need_visit':
      return 'inspection_requested'
    case 'appointment':
      return 'appointment'
    case 'inspected':
      return 'inspected'
    case 'not_interested':
      return 'not_interested'
    // The strongest word the database has. Anything weaker would let a future
    // campaign contact someone who asked not to be.
    case 'do_not_knock':
      return 'do_not_contact'
  }
}

/** Local contact kind to the `activities.activity_type` vocabulary. */
export function remoteActivityType(kind: ContactKind): string {
  switch (kind) {
    case 'door_knock':
      return 'door_knock'
    // Named for what the device witnessed. Not 'call_completed'.
    case 'call_placed':
      return 'call'
    case 'text_initiated':
      return 'text'
    case 'note':
      return 'note'
    case 'appointment_set':
      return 'appointment'
    case 'inspection_started':
      return 'inspection'
  }
}

function propertySeed(lead: ManagedLead) {
  return {
    localId: lead.id,
    addressLine1: lead.address,
    city: lead.city,
    postalCode: lead.postalCode,
    latitude: lead.latitude,
    longitude: lead.longitude,
    propertyType: 'residential',
    subdivision: lead.subdivision,
  }
}

/**
 * The customer, only once there is a name.
 *
 * A door with nobody's name on it is a property, not a person, and inventing a
 * customer row for every house knocked would fill the CRM with empty contacts
 * that the office then has to clean up.
 */
async function ensureLeadCustomer(lead: ManagedLead, orgId: string): Promise<string | null> {
  if (!lead.contactName) return null
  const existing = await getRemoteId('customer', lead.id)
  if (existing) return existing

  const supabase = getSupabase()
  if (!supabase) return null

  const { data, error } = await supabase
    .from('customers')
    .insert({
      organization_id: orgId,
      first_name: lead.contactName,
      primary_phone: lead.contactPhone ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`customer: ${error.message}`)
  await setRemoteId('customer', lead.id, data.id as string)
  return data.id as string
}

export async function pushLead(localId: string, orgId: string, userId: string): Promise<string> {
  const lead = await readLead(localId)
  if (!lead) throw new Error('lead missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const propertyId = await ensurePropertyFor(propertySeed(lead), orgId)
  const customerId = await ensureLeadCustomer(lead, orgId)

  /**
   * A lead the office has already closed out is not the door sheet's to reopen.
   *
   * The two vocabularies are different sizes. A rep's phone can only say
   * 'inspected' about a lead the office has marked 'sold', because there is no
   * sold button at a door — so pushing the mapped status back would silently
   * walk a sold job back to inspected, and nobody would ever know which of the
   * two was true. The rest of the row still goes up; only the status is left
   * to the system that owns it.
   */
  const officeOwnsStatus = lead.remoteStatus ? TERMINAL_REMOTE_STATUSES.has(lead.remoteStatus) : false

  const { data, error } = await supabase
    .from('leads')
    .upsert(
      {
        organization_id: orgId,
        client_id: lead.id,
        property_id: propertyId,
        customer_id: customerId,
        assigned_to: userId,
        ...(officeOwnsStatus ? {} : { status: remoteLeadStatus(lead.status) }),
        opportunity_score: lead.score,
        score_computed_at: lead.createdAt,
        first_contacted_at: lead.knockCount > 0 ? lead.createdAt : null,
        last_activity_at: lead.updatedAt,
        next_action_at: lead.nextActionAt ?? null,
        // The reasons are why this door was worth knocking. They are the one
        // thing the office cannot reconstruct, because the run that produced
        // them is rebuilt from scratch every refresh.
        next_action_note: lead.reasons.join(' · ') || null,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) {
    // One open lead per property is a database rule, not a bug. It fires when
    // two devices have promoted the same address, and the rep needs to be told
    // that rather than watching an item retry forever.
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error(
        `${lead.address} is already an open lead in this organization, probably from another device. ` +
          `This one stays on this phone until the two are merged.`,
      )
    }
    throw new Error(`lead: ${error.message}`)
  }

  const remoteId = data.id as string
  await setRemoteId('lead', localId, remoteId)

  if (lead.appointmentAt) await pushAppointment(lead, propertyId, customerId, orgId, userId)
  return remoteId
}

/**
 * An appointment gets a row of its own, not just a date on the lead.
 *
 * `next_action_at` is a reminder for the rep. An appointment is a commitment
 * made to a homeowner, and it is what the office schedules a day around, so it
 * belongs in the table built for it.
 */
async function pushAppointment(
  lead: ManagedLead,
  propertyId: string,
  customerId: string | null,
  orgId: string,
  userId: string,
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase || !lead.appointmentAt) return

  /**
   * The knock at which this was agreed, not the lead.
   *
   * Keyed on the lead, a second appointment set months after the first was
   * kept would UPSERT over it and the earlier visit would vanish from the
   * record. Leads captured before this field existed fall back to the old key
   * so their appointment keeps updating the row it already has rather than
   * splitting into two.
   */
  const appointmentClientId = lead.appointmentClientId ?? lead.id

  const { data, error } = await supabase
    .from('appointments')
    .upsert(
      {
        organization_id: orgId,
        client_id: appointmentClientId,
        property_id: propertyId,
        customer_id: customerId,
        assigned_to: userId,
        scheduled_start: lead.appointmentAt,
        status: 'scheduled',
        notes: lead.contactName ? `Set at the door with ${lead.contactName}.` : 'Set at the door.',
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`appointment: ${error.message}`)
  await setRemoteId('appointment', appointmentClientId, data.id as string)
}

export async function pushLeadActivity(localId: string, orgId: string, userId: string): Promise<void> {
  const event = await readEvent(localId)
  if (!event) throw new Error('activity missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  // The lead has to exist remotely first. Resolving it here rather than
  // relying on push order means an activity queued while its lead was still
  // failing does not silently attach itself to nothing.
  const leadId = (await getRemoteId('lead', event.leadId)) ?? (await pushLead(event.leadId, orgId, userId))
  const lead = await readLead(event.leadId)
  const propertyId = await getRemoteId('property', event.leadId)

  const { data, error } = await supabase
    .from('activities')
    .upsert(
      {
        organization_id: orgId,
        client_id: event.id,
        lead_id: leadId,
        property_id: propertyId,
        user_id: userId,
        activity_type: remoteActivityType(event.kind),
        outcome: event.outcome ?? null,
        body: event.note ?? null,
        occurred_at: event.at,
        recorded_at_location: lead ? pointOrNull(lead.latitude, lead.longitude) : null,
        // What the phone could say about being there, exactly as it was judged
        // at the time. Null where the event is not a visit at all.
        gps_verification: event.gps?.verification ?? null,
        gps_distance_m: event.gps?.distanceMeters ?? null,
        gps_accuracy_m: event.gps?.accuracyMeters ?? null,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`activity: ${error.message}`)
  await setRemoteId('leadActivity', localId, data.id as string)
}

const BUCKET = 'inspection-photos'

/**
 * The second path segment is the organization, and the storage policy reads it
 * back to decide who may see the file. Changing this shape silently breaks
 * access control, which is why leads are a segment further down rather than a
 * new bucket with a new policy to keep in step.
 */
function attachmentPath(orgId: string, leadId: string, id: string, kind: string): string {
  const ext = kind === 'voice' ? 'webm' : 'jpg'
  return `organization/${orgId}/leads/${leadId}/${kind}/${id}.${ext}`
}

export async function pushLeadAttachment(localId: string, orgId: string, userId: string): Promise<void> {
  const attachment = await readAttachment(localId)
  if (!attachment) throw new Error('attachment missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const leadId =
    (await getRemoteId('lead', attachment.leadId)) ?? (await pushLead(attachment.leadId, orgId, userId))

  /**
   * The knock this was taken during, pushed first if it has not been.
   *
   * Previously this read the id map and accepted `null` when the activity had
   * not synced yet — the attachment row was written with `activity_id = null`
   * and the outbox item was cleared on success, so the link between the photo
   * and the knock it documents was lost permanently and silently. A photo that
   * cannot be tied to the door event it came from is not evidence of anything.
   *
   * Pushing the activity here rather than relying on queue order is the same
   * shape as the lead resolution above, and it survives the case that broke it:
   * an attachment draining in a batch where its activity failed or was never
   * queued.
   */
  let activityId: string | null = null
  if (attachment.eventId) {
    activityId = await getRemoteId('leadActivity', attachment.eventId)
    if (!activityId) {
      await pushLeadActivity(attachment.eventId, orgId, userId)
      activityId = await getRemoteId('leadActivity', attachment.eventId)
      if (!activityId) throw new Error('the knock this was taken during has not synced yet')
    }
  }

  const path = attachmentPath(orgId, leadId, attachment.id, attachment.kind)
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, attachment.blob, {
    contentType: attachment.kind === 'voice' ? attachment.blob.type || 'audio/webm' : 'image/jpeg',
    upsert: true,
  })
  if (upErr) throw new Error(`upload: ${upErr.message}`)

  const { data, error } = await supabase
    .from('lead_attachments')
    .upsert(
      {
        organization_id: orgId,
        client_id: attachment.id,
        lead_id: leadId,
        activity_id: activityId,
        captured_by: userId,
        kind: attachment.kind,
        storage_path: path,
        byte_size: attachment.byteSize,
        duration_seconds: attachment.durationSeconds ?? null,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
        captured_at: attachment.capturedAt,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`attachment row: ${error.message}`)
  await setRemoteId('leadAttachment', localId, data.id as string)
}
