import { openDB, type IDBPDatabase } from 'idb'
import { MAX_SYNC_ATTEMPTS } from './db'
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

export async function getRemoteId(entity: RemoteEntity, localId: string): Promise<string | null> {
  const row = (await (await getMapDb()).get('remoteIds', `${entity}:${localId}`)) as RemoteIdRow | undefined
  return row?.remoteId ?? null
}

export async function setRemoteId(entity: RemoteEntity, localId: string, remoteId: string): Promise<void> {
  await (await getMapDb()).put('remoteIds', {
    id: `${entity}:${localId}`,
    entity,
    localId,
    remoteId,
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
export function isDue(item: Pick<OutboxItem, 'givenUp' | 'nextAttemptAt'>, now: number): boolean {
  if (item.givenUp) return false
  if (!item.nextAttemptAt) return true
  return new Date(item.nextAttemptAt).getTime() <= now
}

/** Items due for an attempt now: never given up, and past any backoff. */
export async function listDueOutbox(now: number = Date.now()): Promise<OutboxItem[]> {
  return (await listOutbox()).filter((item) => isDue(item, now))
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

export async function markOutboxError(id: string, message: string, now: number = Date.now()): Promise<void> {
  const db = await getCaptureDb()
  const item = (await db.get('outbox', id)) as OutboxItem | undefined
  if (!item) return
  const attempts = item.attempts + 1
  await db.put('outbox', {
    ...item,
    attempts,
    lastError: message,
    nextAttemptAt: new Date(now + backoffDelayMs(attempts)).toISOString(),
    givenUp: attempts >= MAX_SYNC_ATTEMPTS,
  })
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
    // Written back without the two fields that hold it out of the queue.
    delete revived.nextAttemptAt
    delete revived.givenUp
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
