import { openDB, type IDBPDatabase } from 'idb'
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

export type RemoteEntity = 'inspection' | 'photo' | 'observation' | 'voiceNote' | 'customer' | 'property'

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

export async function clearOutboxItem(id: string): Promise<void> {
  await (await getCaptureDb()).delete('outbox', id)
}

export async function markOutboxError(id: string, message: string): Promise<void> {
  const db = await getCaptureDb()
  const item = (await db.get('outbox', id)) as OutboxItem | undefined
  if (!item) return
  await db.put('outbox', { ...item, attempts: item.attempts + 1, lastError: message })
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
