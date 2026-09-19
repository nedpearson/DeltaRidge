import { getSupabase } from '../supabase'
import { readInspection, readInspectionBundle, setRemoteId } from '../sync-store'
import { loadEnv } from '../env'
import { buildHandoffPackage, packageFingerprint } from '@/features/handoff/package'
import { requiredCategoriesFor } from '@/features/inspections/photo-categories'
import type { InspectionResolver } from './resolve'

/**
 * Pushes the office package.
 *
 * Ordering matters and is enforced by the drain: the handoff is pushed LAST,
 * after the photos and observations it describes. A package that lands first
 * would point the office at rows that do not exist yet.
 *
 * Status is 'ready', not 'sent'. Nothing here emails anyone or calls
 * CompanyCam — that is the next phase — and marking a row 'sent' when no
 * delivery happened would be a lie the office would act on. 'ready' means
 * exactly what is true: the package is complete, validated, and visible to the
 * office in Supabase.
 */
export async function pushHandoff(localInspectionId: string, orgId: string, userId: string, resolve: InspectionResolver): Promise<void> {
  const inspection = await readInspection(localInspectionId)
  if (!inspection) throw new Error('inspection missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const inspectionId = await resolve(localInspectionId)
  const bundle = await readInspectionBundle(localInspectionId)

  const { payload } = buildHandoffPackage({
    inspection,
    photos: bundle.photos,
    observations: bundle.observations,
    voiceNotes: bundle.voiceNotes,
    requiredCategories: requiredCategoriesFor(inspection.propertyType, inspection.stories),
    ...(inspection.sentToOfficeAt ? { generatedAt: inspection.sentToOfficeAt } : {}),
  })

  // The property id is set as a side effect of resolving the inspection.
  const { data: inspectionRow, error: lookupErr } = await supabase
    .from('inspections')
    .select('property_id, customer_id')
    .eq('id', inspectionId)
    .single()
  if (lookupErr) throw new Error(`handoff lookup: ${lookupErr.message}`)

  let deliveryChannel: string
  try {
    deliveryChannel = loadEnv().VITE_HANDOFF_MODE
  } catch {
    deliveryChannel = 'pdf_email'
  }

  const { data, error } = await supabase
    .from('office_handoffs')
    .upsert(
      {
        organization_id: orgId,
        client_id: localInspectionId,
        inspection_id: inspectionId,
        property_id: inspectionRow.property_id as string,
        customer_id: (inspectionRow.customer_id as string | null) ?? null,
        created_by: userId,
        status: 'ready',
        package_payload: payload,
        payload_hash: packageFingerprint(payload),
        recommended_action: inspection.inspectorRecommendation ?? null,
        validation_result: payload.validation,
        // Recorded as the channel this build is CONFIGURED for, not as a claim
        // that delivery happened. sent_at stays null until something delivers.
        delivery_channel: deliveryChannel,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`handoff: ${error.message}`)
  await setRemoteId('handoff', localInspectionId, data.id as string)
}
