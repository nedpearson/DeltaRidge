import { getSupabase } from '@/lib/supabase'

export async function sendHandoff(inspectionId: string, propertyId: string) {
  // 1. Create the handoff record
  const { data, error } = await getSupabase()!.from('office_handoffs').insert({
    inspection_id: inspectionId,
    property_id: propertyId,
    status: 'draft',
  }).select('id').single()

  if (error || !data) {
    throw new Error('Failed to create handoff record: ' + error?.message)
  }

  // 2. Queue the Roofr push sync job
  const { error: syncError } = await getSupabase()!.from('sync_jobs').insert({
    handoff_id: data.id,
    request_type: 'handoff_narrative',
  })

  if (syncError) {
    throw new Error('Failed to queue sync job: ' + syncError.message)
  }

  return true
}
