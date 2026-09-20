import { openDB, type IDBPDatabase } from 'idb'
import { newId } from '@/lib/db'
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

let dbPromise: Promise<IDBPDatabase> | null = null

function getCrmDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
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
      },
    })
  }
  return dbPromise
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
}

export async function saveLead(lead: ManagedLead): Promise<void> {
  const db = await getCrmDb()
  await db.put(LEADS, lead)
}

export async function addEvent(event: ContactEvent): Promise<void> {
  const db = await getCrmDb()
  await db.put(EVENTS, event)
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
