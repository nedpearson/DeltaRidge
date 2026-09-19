import { getSupabase } from '../supabase'
import { getRemoteId, markSynced, readObservation, readPhoto, readVoiceNote, setRemoteId } from '../sync-store'
import { ensureInspection, pointOrNull } from './resolve'

const BUCKET = 'inspection-photos'

/**
 * Storage paths put the organization in the second segment on purpose: the
 * storage policy reads it back with storage.foldername(name)[2] to decide who
 * may see the file. Changing this shape silently breaks access control.
 */
function photoPath(orgId: string, propertyId: string, inspectionId: string, photoId: string): string {
  return `organization/${orgId}/jobs/${propertyId}/inspections/${inspectionId}/photos/${photoId}.jpg`
}

function voicePath(orgId: string, inspectionId: string, noteId: string): string {
  return `organization/${orgId}/inspections/${inspectionId}/voice/${noteId}.webm`
}

export async function pushPhoto(localId: string, orgId: string, userId: string): Promise<void> {
  if (await getRemoteId('photo', localId)) return
  const photo = await readPhoto(localId)
  if (!photo) throw new Error('photo missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await ensureInspection(photo.inspectionId, orgId, userId)
  const propertyId = (await getRemoteId('property', photo.inspectionId)) ?? 'unknown'
  const path = photoPath(orgId, propertyId, inspectionId, photo.id)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, photo.blob, { contentType: 'image/jpeg', upsert: true })
  if (upErr) throw new Error(`upload: ${upErr.message}`)

  const { data, error } = await supabase
    .from('photos')
    .insert({
      organization_id: orgId,
      inspection_id: inspectionId,
      property_id: propertyId,
      captured_by: userId,
      storage_path: path,
      client_id: photo.id,
      byte_size: photo.byteSize,
      width: photo.width,
      height: photo.height,
      captured_at: photo.capturedAt,
      category: photo.category,
      area: photo.area ?? null,
      quality_flag: photo.qualityFlag ?? null,
      retake_recommended: photo.retakeRecommended,
      upload_state: 'uploaded',
      uploaded_at: new Date().toISOString(),
      location: pointOrNull(photo.latitude, photo.longitude),
    })
    .select('id')
    .single()

  if (error) throw new Error(`photo row: ${error.message}`)
  await setRemoteId('photo', localId, data.id as string)
  await markSynced('photos', localId, 'synced')
}

export async function pushObservation(localId: string, orgId: string, userId: string): Promise<void> {
  if (await getRemoteId('observation', localId)) return
  const o = await readObservation(localId)
  if (!o) throw new Error('observation missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await ensureInspection(o.inspectionId, orgId, userId)
  const { data, error } = await supabase
    .from('inspection_observations')
    .insert({
      organization_id: orgId,
      inspection_id: inspectionId,
      area: o.area ?? null,
      component: o.component ?? null,
      finding: o.finding,
      severity: o.severity,
      source: o.source,
      confirmed_by: o.confirmedAt ? userId : null,
      confirmed_at: o.confirmedAt ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`observation: ${error.message}`)
  await setRemoteId('observation', localId, data.id as string)
  await markSynced('observations', localId, 'synced')
}

export async function pushVoiceNote(localId: string, orgId: string, userId: string): Promise<void> {
  if (await getRemoteId('voiceNote', localId)) return
  const v = await readVoiceNote(localId)
  if (!v) throw new Error('voice note missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await ensureInspection(v.inspectionId, orgId, userId)
  const path = voicePath(orgId, inspectionId, v.id)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, v.blob, { contentType: v.blob.type || 'audio/webm', upsert: true })
  if (upErr) throw new Error(`voice upload: ${upErr.message}`)

  const { data, error } = await supabase
    .from('voice_notes')
    .insert({
      organization_id: orgId,
      inspection_id: inspectionId,
      recorded_by: userId,
      client_id: v.id,
      storage_path: path,
      duration_seconds: v.durationSeconds,
      transcript: v.transcript ?? null,
      recorded_at: v.recordedAt,
      upload_state: 'uploaded',
    })
    .select('id')
    .single()

  if (error) throw new Error(`voice row: ${error.message}`)
  await setRemoteId('voiceNote', localId, data.id as string)
  await markSynced('voiceNotes', localId, 'synced')
}
