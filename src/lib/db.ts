import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { deviceId } from './device'
import type { PhotoCategory } from '@/features/inspections/photo-categories'

/**
 * Offline-first local store.
 *
 * Everything a rep captures lands here FIRST and is considered safe the moment
 * it does. Sync to Supabase is a later, separate concern — a rep on a roof in
 * Livingston Parish with one bar must never lose a photo because a request
 * failed. Records carry client-generated UUIDs so they have a stable identity
 * before the server ever sees them, and an `outbox` queue tracks what still
 * needs pushing.
 */

export type SyncState = 'local' | 'queued' | 'syncing' | 'synced' | 'error'

export interface LocalInspection {
  id: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  status: 'in_progress' | 'complete'
  // Customer
  customerFirstName?: string
  customerLastName?: string
  customerCompanyName?: string
  customerPhone?: string
  customerEmail?: string
  // Property
  addressLine1?: string
  city?: string
  parish?: string
  postalCode?: string
  latitude?: number
  longitude?: number
  propertyType: 'residential' | 'multi_family' | 'commercial' | 'other'
  stories?: number | undefined
  roofMaterial: string
  // Homeowner-supplied, explicitly labelled as such
  homeownerStatedRoofAgeYears?: number | undefined
  homeownerStatedInsurer?: string
  inspectorRecommendation?: string
  waivedCategories?: PhotoCategory[]
  /**
   * Issue codes the rep knowingly finished without. Nothing in the app is a
   * hard gate — a rep standing in a yard with a dead phone still has to be able
   * to close out — but an override is recorded rather than silent, so the
   * office sees exactly what was skipped and by whose decision.
   */
  overriddenIssueCodes?: string[]
  /** Optional free-text reason attached to that override. */
  overrideNote?: string
  /**
   * Set when the rep taps Send to office. The handoff itself is a queued
   * outbox item like anything else — this timestamp is what the UI reads so it
   * can say "the office has this" without waiting on a network round trip.
   */
  sentToOfficeAt?: string
  syncState: SyncState
}

export interface LocalPhoto {
  id: string
  inspectionId: string
  category: PhotoCategory | null
  area?: string
  caption?: string
  blob: Blob
  thumbnail: Blob
  width: number
  height: number
  byteSize: number
  capturedAt: string
  latitude?: number
  longitude?: number
  retakeRecommended: boolean
  qualityFlag?: string
  syncState: SyncState
}

export interface LocalObservation {
  id: string
  inspectionId: string
  area?: string
  component?: string
  finding: string
  severity: 'none_noted' | 'minor' | 'moderate' | 'significant' | 'requires_verification'
  source: 'inspector' | 'voice' | 'ai'
  confirmedAt?: string
  createdAt: string
  syncState: SyncState
}

export interface LocalVoiceNote {
  id: string
  inspectionId: string
  blob: Blob
  durationSeconds: number
  transcript?: string
  recordedAt: string
  syncState: SyncState
}

export type OutboxEntity =
  | 'inspection'
  | 'photo'
  | 'observation'
  | 'voiceNote'
  | 'handoff'
  /** A managed lead. Lives in the CRM database; queued through this outbox. */
  | 'lead'
  /** One knock, call, text or note against a lead. */
  | 'leadActivity'
  /** A voice note or photo captured while working a lead. */
  | 'leadAttachment'
  /**
   * A stretch of door-knocking the rep started and stopped.
   *
   * Through this queue and not a separate uploader, deliberately. Route data
   * looks like telemetry, and telemetry is the kind of thing that gets its own
   * "simpler" path which silently drops rows on a bad connection — which is the
   * offline-sync problem the lead layer already has a solution for.
   */
  | 'routeSession'
  /** One GPS fix inside one of those sessions. Never outside one. */
  | 'routePoint'

export interface OutboxItem {
  id: string
  entity: OutboxEntity
  entityId: string
  op: 'upsert'
  queuedAt: string
  attempts: number
  lastError?: string
  /**
   * Who was signed in when this was captured, and where.
   *
   * These three exist to answer a question the queue previously could not:
   * whose work is this? A field phone gets handed between reps, a shift ends
   * with a sign-out, a token expires halfway down a street. An anonymous queue
   * drained by whoever signs in next files one rep's doors under another rep's
   * name — which then flows into their numbers, their commission and their
   * performance review.
   *
   * `userId` is null when nothing was signed in at capture time. That work
   * belongs to the device and is claimed by the next person to sign in ON THIS
   * DEVICE, because that is who knocked the door. Work captured under a
   * DIFFERENT user is never pushed under the current one — it is held and
   * shown. See `ownsOutboxItem`.
   *
   * Undefined, rather than null, means the item predates this field. Those are
   * treated as claimable: they were queued before the app could tell, and the
   * only device they can be on is this one.
   */
  userId?: string | null
  orgId?: string | null
  deviceId?: string
  /**
   * Set when the server refused for a reason no retry can fix on its own —
   * today that means authentication. Held separately from `lastError` because
   * it must NOT consume an attempt: a token that expired mid-street is not six
   * failures, it is one sign-in away, and burning the retry budget on it is how
   * a day of real field work reaches `givenUp` and stops trying.
   */
  blockedReason?: 'auth'
  /**
   * Earliest time this item should be attempted again. Absent means "now".
   *
   * Without this, a permanently failing item — a photo whose inspection was
   * deleted, a row rejected by a constraint — is retried every 30 seconds for
   * the rest of the rep's day, burning battery and signal on a request that
   * cannot succeed. Backoff is applied in `markOutboxError`.
   */
  nextAttemptAt?: string
  /**
   * Set once the item has exhausted its attempts. It stops being retried
   * automatically and starts being *shown*, because a queue that silently stops
   * trying is indistinguishable from a queue that lost the work.
   */
  givenUp?: boolean
}

/** Attempts before an item stops retrying on its own and asks for a human. */
export const MAX_SYNC_ATTEMPTS = 6

/**
 * What the queue is doing with one item, in words a person can act on.
 *
 * Derived rather than stored. The underlying state is already fully described
 * by attempts, backoff, the blocked reason and the give-up flag; storing a
 * status alongside them would create a second source of truth that can
 * disagree with the first.
 */
export type OutboxStatus = 'pending' | 'retry' | 'blocked_auth' | 'not_yours' | 'failed'

export function outboxStatus(
  item: OutboxItem,
  currentUserId: string | null,
  now: number = Date.now(),
): OutboxStatus {
  if (item.givenUp) return 'failed'
  if (!ownsOutboxItem(item, currentUserId)) return 'not_yours'
  if (item.blockedReason === 'auth') return 'blocked_auth'
  if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > now) return 'retry'
  return 'pending'
}

/**
 * Whether the signed-in user may push this item.
 *
 * Unowned work (queued while signed out, or queued before the app recorded an
 * owner) is claimable by whoever signs in on this device — they are the person
 * who did it. Work captured under another account is not claimable by anyone,
 * ever, including an admin: it stays on the device, visible and counted, until
 * its own rep signs back in.
 */
export function ownsOutboxItem(item: OutboxItem, currentUserId: string | null): boolean {
  if (!currentUserId) return false
  if (item.userId === undefined || item.userId === null) return true
  return item.userId === currentUserId
}

interface DeltaRidgeDB extends DBSchema {
  inspections: { key: string; value: LocalInspection; indexes: { 'by-updated': string } }
  photos: { key: string; value: LocalPhoto; indexes: { 'by-inspection': string } }
  observations: { key: string; value: LocalObservation; indexes: { 'by-inspection': string } }
  voiceNotes: { key: string; value: LocalVoiceNote; indexes: { 'by-inspection': string } }
  outbox: { key: string; value: OutboxItem }
}

let dbPromise: Promise<IDBPDatabase<DeltaRidgeDB>> | null = null

export function getDB(): Promise<IDBPDatabase<DeltaRidgeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DeltaRidgeDB>('delta-ridge', 1, {
      upgrade(db) {
        const inspections = db.createObjectStore('inspections', { keyPath: 'id' })
        inspections.createIndex('by-updated', 'updatedAt')

        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('by-inspection', 'inspectionId')

        const observations = db.createObjectStore('observations', { keyPath: 'id' })
        observations.createIndex('by-inspection', 'inspectionId')

        const voiceNotes = db.createObjectStore('voiceNotes', { keyPath: 'id' })
        voiceNotes.createIndex('by-inspection', 'inspectionId')

        db.createObjectStore('outbox', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function newId(): string {
  // crypto.randomUUID is unavailable on some older mobile browsers and on
  // insecure origins, so fall back rather than throw in the field.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Queues an entity for push. The id is `entity:entityId`, so editing the same
 * inspection twenty times before regaining signal leaves one queue item that
 * pushes the latest state — not twenty pushes of twenty intermediate versions.
 *
 * Re-queueing clears any previous failure: a rep who fixes the underlying
 * problem (fills in the address, signs in) should not have to wait out a
 * backoff earned by the broken version.
 */
async function enqueue(
  db: IDBPDatabase<DeltaRidgeDB>,
  entity: OutboxEntity,
  entityId: string,
): Promise<void> {
  const existing = await db.get('outbox', `${entity}:${entityId}`)
  const owner = currentOwner()
  await db.put('outbox', {
    id: `${entity}:${entityId}`,
    entity,
    entityId,
    op: 'upsert',
    queuedAt: existing?.queuedAt ?? new Date().toISOString(),
    attempts: 0,
    // Ownership is stamped on FIRST capture and never reassigned by a later
    // edit. Otherwise a second rep opening the same lead to fix a typo would
    // quietly take ownership of the first rep's knock.
    userId: existing?.userId !== undefined ? existing.userId : owner.userId,
    orgId: existing?.orgId !== undefined ? existing.orgId : owner.orgId,
    deviceId: existing?.deviceId ?? deviceId(),
  })
}

/**
 * Who is signed in right now, for stamping onto a new queue item.
 *
 * A module-level hook rather than a parameter on every save call. `queueSync`
 * is called from a dozen places — a knock, a note, a photo, a status change —
 * and threading the session through all of them would mean any future caller
 * that forgot it would silently queue unowned work.
 */
let ownerHook: () => { userId: string | null; orgId: string | null } = () => ({
  userId: null,
  orgId: null,
})

export function setOutboxOwnerSource(
  fn: () => { userId: string | null; orgId: string | null },
): void {
  ownerHook = fn
}

function currentOwner(): { userId: string | null; orgId: string | null } {
  try {
    return ownerHook()
  } catch {
    return { userId: null, orgId: null }
  }
}

/**
 * Queues something that lives in another database.
 *
 * The outbox is deliberately the only queue in the app, even though leads live
 * in their own store. A second queue would mean a second retry schedule, a
 * second backoff, and a second place for a rep's work to go quiet — and the
 * sync panel could no longer answer "is anything still waiting?" with one
 * number.
 */
export async function queueSync(entity: OutboxEntity, entityId: string): Promise<void> {
  await enqueue(await getDB(), entity, entityId)
}

/**
 * Removes a queued item, for something deleted locally before it ever synced.
 */
export async function unqueueSync(entity: OutboxEntity, entityId: string): Promise<void> {
  await (await getDB()).delete('outbox', `${entity}:${entityId}`)
}

/**
 * Marks an inspection as handed to the office and queues the package.
 *
 * Deliberately separate from `saveInspection`: completing an inspection and
 * sending it are different decisions, and only the second one should create a
 * record the office can act on.
 */
export async function queueHandoff(inspectionId: string): Promise<void> {
  const db = await getDB()
  const inspection = await db.get('inspections', inspectionId)
  if (!inspection) throw new Error('inspection missing locally')
  await db.put('inspections', {
    ...inspection,
    sentToOfficeAt: inspection.sentToOfficeAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await enqueue(db, 'inspection', inspectionId)
  await enqueue(db, 'handoff', inspectionId)
}

export async function saveInspection(inspection: LocalInspection): Promise<void> {
  const db = await getDB()
  await db.put('inspections', { ...inspection, updatedAt: new Date().toISOString() })
  await enqueue(db, 'inspection', inspection.id)
}

export async function getInspection(id: string): Promise<LocalInspection | undefined> {
  return (await getDB()).get('inspections', id)
}

export async function listInspections(): Promise<LocalInspection[]> {
  const all = await (await getDB()).getAll('inspections')
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function savePhoto(photo: LocalPhoto): Promise<void> {
  const db = await getDB()
  await db.put('photos', photo)
  await enqueue(db, 'photo', photo.id)
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('photos', id)
  await db.delete('outbox', `photo:${id}`)
}

export async function listPhotos(inspectionId: string): Promise<LocalPhoto[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex('photos', 'by-inspection', inspectionId)
  return rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

export async function saveObservation(observation: LocalObservation): Promise<void> {
  const db = await getDB()
  await db.put('observations', observation)
  await enqueue(db, 'observation', observation.id)
}

export async function deleteObservation(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('observations', id)
  await db.delete('outbox', `observation:${id}`)
}

export async function listObservations(inspectionId: string): Promise<LocalObservation[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex('observations', 'by-inspection', inspectionId)
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function saveVoiceNote(note: LocalVoiceNote): Promise<void> {
  const db = await getDB()
  await db.put('voiceNotes', note)
  await enqueue(db, 'voiceNote', note.id)
}

export async function listVoiceNotes(inspectionId: string): Promise<LocalVoiceNote[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex('voiceNotes', 'by-inspection', inspectionId)
  return rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

export async function outboxCount(): Promise<number> {
  return (await getDB()).count('outbox')
}

/** Rough bytes held locally, so a rep can see storage filling before it bites. */
export async function localStorageFootprint(): Promise<number> {
  const db = await getDB()
  const photos = await db.getAll('photos')
  return photos.reduce((sum, p) => sum + p.byteSize, 0)
}
