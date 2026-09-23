import { openDB, type IDBPDatabase } from 'idb'
import { MAX_SYNC_ATTEMPTS, ownsOutboxItem } from './db'
import type { LocalInspection, LocalObservation, LocalPhoto, LocalVoiceNote, OutboxItem, SyncState } from './db'

/**
 * Sync bookkeeping, deliberately kept in its own IndexedDB database.
 *
 * The capture store (`delta-ridge`) holds the rep's work and must never be put
 * at risk by a schema migration for something as incidental as remembering
 * which rows have been pushed. Keeping the local-to-remote id map in a separate
 * database means the sync layer can evolve without ever touching the store that
 * holds the photos.
 */

interface RemoteIdRow {
  id: string
  entity: string
  localId: string
  remoteId: string
  /** Null only on rows written before the map was scoped. */
  orgId?: string | null
  syncedAt: string
}

let mapDb: Promise<IDBPDatabase> | null = null

function getMapDb(): Promise<IDBPDatabase> {
  if (!mapDb) {
    mapDb = openDB('delta-ridge-sync', 1, {
      upgrade(db) {
        db.createObjectStore('remoteIds', { keyPath: 'id' })
      },
    })
  }
  return mapDb
}

/**
 * Opens the capture store at whatever version already exists, without an
 * upgrade callback. That is the point: this module reads and updates the rep's
 * data but never migrates it.
 */
function getCaptureDb(): Promise<IDBPDatabase> {
  return openDB('delta-ridge')
}

export type RemoteEntity =
  | 'inspection'
  | 'photo'
  | 'observation'
  | 'voiceNote'
  | 'customer'
  | 'property'
  | 'handoff'
  | 'lead'
  | 'leadActivity'
  | 'leadAttachment'
  | 'appointment'
  | 'routeSession'
  | 'routePoint'

/**
 * Which organisation's server the map currently describes.
 *
 * A local id means nothing on its own — it is a claim that "this row of mine is
 * that row of theirs", and *theirs* is one organisation's database. A phone
 * used by two reps from different companies would otherwise resolve one org's
 * local id to the other org's remote id and push a lead straight into the
 * wrong company's CRM. Reps within the SAME organisation are meant to share
 * these mappings, which is why the scope is the org and not the user.
 *
 * Set once per drain and per pull rather than threaded through twenty call
 * sites, on the same reasoning as the outbox owner hook: a caller that forgot
 * the parameter would silently write an unscoped mapping.
 */
let remoteIdScope: string | null = null

export function setRemoteIdScope(orgId: string | null): void {
  remoteIdScope = orgId
}

function scopedKey(entity: RemoteEntity, localId: string): string {
  return `${remoteIdScope ?? 'unscoped'}:${entity}:${localId}`
}

export async function getRemoteId(entity: RemoteEntity, localId: string): Promise<string | null> {
  const db = await getMapDb()
  const row = (await db.get('remoteIds', scopedKey(entity, localId))) as RemoteIdRow | undefined
  if (row) return row.remoteId

  // Mappings written before scoping existed. There was only ever one
  // organisation on a device at that point, so adopting them into the current
  // scope is safe — and dropping them instead would make every lead on the
  // phone insert a second time.
  const legacy = (await db.get('remoteIds', `${entity}:${localId}`)) as RemoteIdRow | undefined
  if (!legacy) return null
  await setRemoteId(entity, localId, legacy.remoteId)
  return legacy.remoteId
}

export async function setRemoteId(entity: RemoteEntity, localId: string, remoteId: string): Promise<void> {
  await (await getMapDb()).put('remoteIds', {
    id: scopedKey(entity, localId),
    entity,
    localId,
    remoteId,
    orgId: remoteIdScope,
    syncedAt: new Date().toISOString(),
  })
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const rows = (await (await getCaptureDb()).getAll('outbox')) as OutboxItem[]
  return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/**
 * Whether an item should be attempted on this drain. Pure, so the retry
 * schedule can be tested without a clock or a database.
 */
export function isDue(
  item: Pick<OutboxItem, 'givenUp' | 'nextAttemptAt' | 'blockedReason'>,
  now: number,
): boolean {
  if (item.givenUp) return false
  // An auth-blocked item is retried immediately once there is a session again,
  // with no backoff to wait out: the thing that was wrong was the sign-in, and
  // it has just been fixed.
  if (item.blockedReason === 'auth') return true
  if (!item.nextAttemptAt) return true
  return new Date(item.nextAttemptAt).getTime() <= now
}

/**
 * Items this user may attempt now: theirs, not given up, past any backoff.
 *
 * The ownership filter is the load-bearing part. Without it, a rep signing in
 * on a colleague's phone drains the colleague's queue under their own account,
 * and every one of those doors lands in the wrong rep's numbers.
 */
export async function listDueOutbox(
  currentUserId: string | null,
  now: number = Date.now(),
): Promise<OutboxItem[]> {
  return (await listOutbox()).filter(
    (item) => ownsOutboxItem(item, currentUserId) && isDue(item, now),
  )
}

/**
 * Work on this device that belongs to a different sign-in. Never pushed.
 *
 * Empty when nobody is signed in, and that is the load-bearing part. Ownership
 * is decided against the current user, so with no current user EVERY item fails
 * the check — which had the signed-out home screen announcing "1 item on this
 * phone belongs to another sign-in" about the rep's own unsent work. Alarming,
 * and false: without a signed-in user there is nobody for the work to belong to
 * instead. Signed out, queued work is simply waiting, and the panel says so.
 */
export async function listForeignOutbox(currentUserId: string | null): Promise<OutboxItem[]> {
  if (!currentUserId) return []
  return (await listOutbox()).filter((item) => !ownsOutboxItem(item, currentUserId))
}

/** Items that stopped retrying on their own and need the rep to see them. */
export async function listStalledOutbox(): Promise<OutboxItem[]> {
  return (await listOutbox()).filter((item) => item.givenUp)
}

export async function clearOutboxItem(id: string): Promise<void> {
  await (await getCaptureDb()).delete('outbox', id)
}

/**
 * Exponential backoff with a ceiling: 5s, 10s, 20s, 40s, 80s, capped at 5
 * minutes. Deterministic and pure so the schedule can be tested without
 * waiting for it.
 */
export function backoffDelayMs(attempts: number): number {
  const base = 5_000 * 2 ** Math.max(0, attempts - 1)
  return Math.min(base, 300_000)
}

/**
 * Errors the retry budget must not be spent on.
 *
 * An expired or missing token is not six failures followed by permanent
 * surrender; it is one sign-in away. Counting it as a failure is how a day of
 * real field work reaches `givenUp` while the rep is doing nothing wrong and
 * sees nothing to fix.
 *
 * Matched on the wire text because Supabase surfaces these as ordinary request
 * errors rather than a typed code. Deliberately narrow: anything not clearly
 * about authentication is treated as a normal failure and does consume an
 * attempt, because silently exempting unknown errors would let a genuinely
 * broken item retry forever.
 */
export function isAuthError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('jwt') ||
    m.includes('token') ||
    m.includes('not authenticated') ||
    m.includes('unauthorized') ||
    m.includes('401') ||
    m.includes('invalid claim') ||
    m.includes('session')
  )
}

export async function markOutboxError(id: string, message: string, now: number = Date.now()): Promise<void> {
  const db = await getCaptureDb()
  const item = (await db.get('outbox', id)) as OutboxItem | undefined
  if (!item) return

  if (isAuthError(message)) {
    // Recorded, shown, and left with its attempt count untouched.
    await db.put('outbox', { ...item, lastError: message, blockedReason: 'auth' })
    return
  }

  const attempts = item.attempts + 1
  const next: OutboxItem = {
    ...item,
    attempts,
    lastError: message,
    nextAttemptAt: new Date(now + backoffDelayMs(attempts)).toISOString(),
    givenUp: attempts >= MAX_SYNC_ATTEMPTS,
  }
  delete next.blockedReason
  await db.put('outbox', next)
}

/** Clears the auth block once a session exists again, without touching attempts. */
export async function unblockAuthOutbox(): Promise<number> {
  const db = await getCaptureDb()
  const blocked = (await listOutbox()).filter((i) => i.blockedReason === 'auth')
  for (const item of blocked) {
    const revived: OutboxItem = { ...item }
    delete revived.blockedReason
    delete revived.nextAttemptAt
    await db.put('outbox', revived)
  }
  return blocked.length
}

/**
 * Puts stalled items back in the queue at the front of the line.
 *
 * The rep's mental model is "try again", so this clears the attempt count as
 * well as the flag — otherwise the first failure after a manual retry would
 * immediately re-stall the item and the button would look broken.
 */
export async function retryStalledOutbox(): Promise<number> {
  const db = await getCaptureDb()
  const stalled = (await listOutbox()).filter((i) => i.givenUp)
  for (const item of stalled) {
    const revived: OutboxItem = { ...item, attempts: 0 }
    // Written back without the fields that hold it out of the queue.
    delete revived.nextAttemptAt
    delete revived.givenUp
    delete revived.blockedReason
    await db.put('outbox', revived)
  }
  return stalled.length
}

export async function readInspection(id: string): Promise<LocalInspection | undefined> {
  return (await getCaptureDb()).get('inspections', id) as Promise<LocalInspection | undefined>
}

export async function readPhoto(id: string): Promise<LocalPhoto | undefined> {
  return (await getCaptureDb()).get('photos', id) as Promise<LocalPhoto | undefined>
}

export async function readObservation(id: string): Promise<LocalObservation | undefined> {
  return (await getCaptureDb()).get('observations', id) as Promise<LocalObservation | undefined>
}

export async function readVoiceNote(id: string): Promise<LocalVoiceNote | undefined> {
  return (await getCaptureDb()).get('voiceNotes', id) as Promise<LocalVoiceNote | undefined>
}

/** Everything captured against one inspection, for building the office package. */
export async function readInspectionBundle(inspectionId: string): Promise<{
  photos: LocalPhoto[]
  observations: LocalObservation[]
  voiceNotes: LocalVoiceNote[]
}> {
  const db = await getCaptureDb()
  const [photos, observations, voiceNotes] = await Promise.all([
    db.getAllFromIndex('photos', 'by-inspection', inspectionId) as Promise<LocalPhoto[]>,
    db.getAllFromIndex('observations', 'by-inspection', inspectionId) as Promise<LocalObservation[]>,
    db.getAllFromIndex('voiceNotes', 'by-inspection', inspectionId) as Promise<LocalVoiceNote[]>,
  ])
  return { photos, observations, voiceNotes }
}

export async function markSynced(
  store: 'inspections' | 'photos' | 'observations' | 'voiceNotes',
  id: string,
  syncState: SyncState,
): Promise<void> {
  const db = await getCaptureDb()
  const row = await db.get(store, id)
  if (!row) return
  await db.put(store, { ...(row as object), syncState })
}
