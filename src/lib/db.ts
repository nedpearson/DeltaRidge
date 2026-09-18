import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
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

export interface OutboxItem {
  id: string
  entity: 'inspection' | 'photo' | 'observation' | 'voiceNote'
  entityId: string
  op: 'upsert'
  queuedAt: string
  attempts: number
  lastError?: string
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

async function enqueue(
  db: IDBPDatabase<DeltaRidgeDB>,
  entity: OutboxItem['entity'],
  entityId: string,
): Promise<void> {
  await db.put('outbox', {
    id: `${entity}:${entityId}`,
    entity,
    entityId,
    op: 'upsert',
    queuedAt: new Date().toISOString(),
    attempts: 0,
  })
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
