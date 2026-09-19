import { getSupabase } from '../supabase'
import { getRemoteId, markSynced, readObservation, readPhoto, readVoiceNote, setRemoteId } from '../sync-store'
import { pointOrNull, type InspectionResolver } from './resolve'

const BUCKET = 'inspection-photos'

/**
 * Every push here is an UPSERT keyed on (organization_id, client_id).
 *
 * The failure this defends against is specific and common in the field: the
 * row is written, and the response never arrives because the rep walked behind
 * a chimney. The item stays in the outbox and is retried. With an INSERT that
 * retry hits the unique constraint, fails with 23505 forever, and the photo
 * appears stuck to a rep who did nothing wrong. With an UPSERT it resolves to
 * a no-op update and clears.
 */

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

export async function pushPhoto(localId: string, orgId: string, userId: string, resolve: InspectionResolver): Promise<void> {
  const photo = await readPhoto(localId)
  if (!photo) throw new Error('photo missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await resolve(photo.inspectionId)
  const propertyId = await getRemoteId('property', photo.inspectionId)
  // Resolving the inspection creates the property first, so a miss here means
  // something is genuinely wrong. Inventing a placeholder id would write the
  // photo to a path nobody can find and then fail the row insert anyway.
  if (!propertyId) throw new Error('property not resolved for this inspection')

  const path = photoPath(orgId, propertyId, inspectionId, photo.id)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, photo.blob, { contentType: 'image/jpeg', upsert: true })
  if (upErr) throw new Error(`upload: ${upErr.message}`)

  const { data, error } = await supabase
    .from('photos')
    .upsert(
      {
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
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`photo row: ${error.message}`)
  await setRemoteId('photo', localId, data.id as string)
  await markSynced('photos', localId, 'synced')
}

export async function pushObservation(localId: string, orgId: string, userId: string, resolve: InspectionResolver): Promise<void> {
  const o = await readObservation(localId)
  if (!o) throw new Error('observation missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await resolve(o.inspectionId)
  const { data, error } = await supabase
    .from('inspection_observations')
    .upsert(
      {
        organization_id: orgId,
        client_id: o.id,
        inspection_id: inspectionId,
        area: o.area ?? null,
        component: o.component ?? null,
        finding: o.finding,
        severity: o.severity,
        source: o.source,
        confirmed_by: o.confirmedAt ? userId : null,
        confirmed_at: o.confirmedAt ?? null,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`observation: ${error.message}`)
  await setRemoteId('observation', localId, data.id as string)
  await markSynced('observations', localId, 'synced')
}

export async function pushVoiceNote(localId: string, orgId: string, userId: string, resolve: InspectionResolver): Promise<void> {
  const v = await readVoiceNote(localId)
  if (!v) throw new Error('voice note missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await resolve(v.inspectionId)
  const path = voicePath(orgId, inspectionId, v.id)

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, v.blob, { contentType: v.blob.type || 'audio/webm', upsert: true })
  if (upErr) throw new Error(`voice upload: ${upErr.message}`)

  const { data, error } = await supabase
    .from('voice_notes')
    .upsert(
      {
        organization_id: orgId,
        client_id: v.id,
        inspection_id: inspectionId,
        recorded_by: userId,
        storage_path: path,
        duration_seconds: v.durationSeconds,
        transcript: v.transcript ?? null,
        recorded_at: v.recordedAt,
        upload_state: 'uploaded',
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`voice row: ${error.message}`)
  await setRemoteId('voiceNote', localId, data.id as string)
  await markSynced('voiceNotes', localId, 'synced')
}
