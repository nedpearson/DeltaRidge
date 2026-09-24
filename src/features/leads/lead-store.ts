import { openDB, type IDBPDatabase } from 'idb'
import { newId, queueSync } from '@/lib/db'
import type { ContactEvent, ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'

/**
 * Where a contacted door lives.
 *
 * Its own database, separate from both the disposable lead run and the rep's
 * captured inspection work. The run cache is rebuilt from scratch every
 * refresh and may be cleared at any time; a lead with a conversation attached
 * to it must never be inside something that gets thrown away.
 */

const DB_NAME = 'delta-ridge-crm'
const LEADS = 'leads'
const EVENTS = 'events'
const ATTACHMENTS = 'attachments'

/**
 * A recording or a photo taken against a lead, not against an inspection.
 *
 * These are two different acts. An inspection photo documents a roof for a
 * claim; a lead photo is the rep's own memory — the gate code, the dog, the
 * business card, the streak on the ceiling the homeowner pointed at. Filing
 * them in the same place would put unvetted driveway snapshots into the
 * evidence package that goes to an adjuster.
 */
export interface LeadAttachment {
  id: string
  leadId: string
  /** The contact event this was captured alongside. */
  eventId: string
  kind: 'voice' | 'photo'
  blob: Blob
  thumbnail?: Blob
  durationSeconds?: number
  width?: number
  height?: number
  byteSize: number
  capturedAt: string
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getCrmDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(LEADS)) {
          const leads = db.createObjectStore(LEADS, { keyPath: 'id' })
          // One managed lead per address, so a refreshed run can find it again.
          leads.createIndex('by-address', 'addressKey', { unique: true })
          leads.createIndex('by-status', 'status')
        }
        if (!db.objectStoreNames.contains(EVENTS)) {
          const events = db.createObjectStore(EVENTS, { keyPath: 'id' })
          events.createIndex('by-lead', 'leadId')
        }
        // Guarded rather than keyed off oldVersion alone: a device that opened
        // the database at v1 and a device installing fresh both have to end up
        // with the same stores, and a missing store is a permanent crash.
        if (oldVersion < 2 && !db.objectStoreNames.contains(ATTACHMENTS)) {
          const attachments = db.createObjectStore(ATTACHMENTS, { keyPath: 'id' })
          attachments.createIndex('by-lead', 'leadId')
          attachments.createIndex('by-event', 'eventId')
        }
      },
    })
  }
  return dbPromise
}

export async function saveAttachment(attachment: LeadAttachment): Promise<void> {
  const db = await getCrmDb()
  await db.put(ATTACHMENTS, attachment)
  try {
    await queueSync('leadAttachment', attachment.id)
  } catch {
    // Best-effort, like every other enqueue here. The capture is already safe.
  }
}

export async function readAttachment(id: string): Promise<LeadAttachment | null> {
  try {
    const db = await getCrmDb()
    return ((await db.get(ATTACHMENTS, id)) as LeadAttachment | undefined) ?? null
  } catch {
    return null
  }
}

export async function listAttachments(leadId: string): Promise<LeadAttachment[]> {
  try {
    const db = await getCrmDb()
    const rows = (await db.getAllFromIndex(ATTACHMENTS, 'by-lead', leadId)) as LeadAttachment[]
    return rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  } catch {
    return []
  }
}

/**
 * Turns a row in today's door list into a record that outlives it.
 *
 * The score and the reasons are COPIED, not referenced. Tomorrow's run will
 * rank this address differently — a new storm, a re-roof permit filed, another
 * year of roof age — and the note attached to the conversation has to keep
 * saying what the rep was actually looking at when they knocked.
 */
export function promote(lead: ScoredLead, at: string): ManagedLead {
  return {
    id: newId(),
    addressKey: lead.addressKey,
    address: lead.address,
    latitude: lead.latitude,
    longitude: lead.longitude,
    ...(lead.city !== undefined ? { city: lead.city } : {}),
    ...(lead.postalCode !== undefined ? { postalCode: lead.postalCode } : {}),
    ...(lead.subdivision !== undefined ? { subdivision: lead.subdivision } : {}),
    score: lead.score,
    reasons: [...lead.reasons],
    status: 'new',
    createdAt: at,
    updatedAt: at,
    knockCount: 0,
  }
}

export async function readLeads(): Promise<ManagedLead[]> {
  try {
    const db = await getCrmDb()
    return (await db.getAll(LEADS)) as ManagedLead[]
  } catch {
    // No CRM database is an empty pipeline, not a broken screen.
    return []
  }
}

export async function readLead(id: string): Promise<ManagedLead | null> {
  try {
    const db = await getCrmDb()
    return ((await db.get(LEADS, id)) as ManagedLead | undefined) ?? null
  } catch {
    return null
  }
}

export async function findByAddress(addressKey: string): Promise<ManagedLead | null> {
  try {
    const db = await getCrmDb()
    return (
      ((await db.getFromIndex(LEADS, 'by-address', addressKey)) as ManagedLead | undefined) ?? null
    )
  } catch {
    return null
  }
}

/**
 * Writes the lead and the event that justifies it together.
 *
 * One transaction on purpose: a status with no history behind it is how a
 * pipeline starts lying about what was said at a door.
 */
export async function saveOutcome(lead: ManagedLead, event: ContactEvent): Promise<void> {
  const db = await getCrmDb()
  const tx = db.transaction([LEADS, EVENTS], 'readwrite')
  await Promise.all([
    tx.objectStore(LEADS).put(lead),
    tx.objectStore(EVENTS).put(event),
    tx.done,
  ])
  // Queued only after the local write has committed. The rep's record is safe
  // the moment it is on the device; the push is a later, separate concern that
  // must never be able to fail the thing that already succeeded.
  await queue(lead, event)
}

export async function saveLead(lead: ManagedLead): Promise<void> {
  const db = await getCrmDb()
  await db.put(LEADS, lead)
  await queue(lead)
}

/**
 * Writes a lead that came FROM the server, without queueing it back.
 *
 * The distinction matters: `saveLead` means "the rep changed this, tell the
 * office". This means "the office already knows". Routing a pulled row through
 * the normal save would enqueue a push of the row that was just received, which
 * at best wastes a request and at worst writes a stale local view back over a
 * newer server one.
 */
export async function saveLeadFromServer(lead: ManagedLead): Promise<void> {
  const db = await getCrmDb()
  await db.put(LEADS, lead)
}

/** As above, for a knock that was recorded on another device. */
export async function saveEventFromServer(event: ContactEvent): Promise<void> {
  const db = await getCrmDb()
  await db.put(EVENTS, event)
}

export async function addEvent(event: ContactEvent): Promise<void> {
  const db = await getCrmDb()
  await db.put(EVENTS, event)
  await queue(null, event)
}

/** Queueing is best-effort: a failed enqueue must not lose the rep's work. */
async function queue(lead: ManagedLead | null, event?: ContactEvent): Promise<void> {
  try {
    if (lead) await queueSync('lead', lead.id)
    if (event) await queueSync('leadActivity', event.id)
  } catch {
    // The next write to this lead re-queues it, and the sync panel counts what
    // is actually waiting rather than what was supposed to be.
  }
}

export async function readEvent(id: string): Promise<ContactEvent | null> {
  try {
    const db = await getCrmDb()
    return ((await db.get(EVENTS, id)) as ContactEvent | undefined) ?? null
  } catch {
    return null
  }
}

export async function readHistory(leadId: string): Promise<ContactEvent[]> {
  try {
    const db = await getCrmDb()
    const events = (await db.getAllFromIndex(EVENTS, 'by-lead', leadId)) as ContactEvent[]
    return events.sort((a, b) => b.at.localeCompare(a.at))
  } catch {
    return []
  }
}

/**
 * Everything recorded between two instants, on this device.
 *
 * Reads the whole store and filters, because the events store is indexed by
 * lead rather than by time. That is the right index for the screen this store
 * exists to serve — a lead's history — and adding a second index to answer one
 * panel would mean a schema version bump on every rep's phone for a list that
 * is a few hundred rows on a heavy day.
 */
export async function eventsBetween(from: string, to: string): Promise<ContactEvent[]> {
  try {
    const db = await getCrmDb()
    const events = (await db.getAll(EVENTS)) as ContactEvent[]
    return events.filter((e) => e.at >= from && e.at <= to).sort((a, b) => a.at.localeCompare(b.at))
  } catch {
    return []
  }
}

/** Address keys that must never be offered as a door again. */
export function suppressedKeys(leads: readonly ManagedLead[]): Set<string> {
  const out = new Set<string>()
  for (const lead of leads) {
    if (lead.status === 'do_not_knock' || lead.status === 'not_interested') {
      out.add(lead.addressKey)
    }
  }
  return out
}

/** Every address already promoted, so the door list can show its status. */
export function byAddress(leads: readonly ManagedLead[]): Map<string, ManagedLead> {
  return new Map(leads.map((lead) => [lead.addressKey, lead]))
}
