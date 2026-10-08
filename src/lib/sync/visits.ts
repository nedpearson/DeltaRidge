import { getDB } from '../db'
import { getSupabase } from '../supabase'
import { getRemoteId } from '../sync-store'
import { pushLead } from './leads'
import { pushRouteSession } from './routes'

export async function pushPropertyVisit(localId: string, orgId: string, userId: string): Promise<void> {
  const db = await getDB()
  const visit = await db.get('propertyVisits', localId)
  if (!visit) throw new Error('Property visit is missing on this device.')
  const supabase = getSupabase()
  if (!supabase) throw new Error('Sign in to sync property visits.')
  const leadId = await getRemoteId('lead', visit.leadId) ?? await pushLead(visit.leadId, orgId, userId)
  const { data: lead, error: leadError } = await supabase.from('leads')
    .select('property_id').eq('id', leadId).eq('organization_id', orgId).single()
  if (leadError || !lead?.property_id) throw new Error('Unable to resolve the property for this visit.')
  const routeId = visit.routeSessionId
    ? await getRemoteId('routeSession', visit.routeSessionId) ?? await pushRouteSession(visit.routeSessionId, orgId, userId)
    : null
  const { error } = await supabase.from('property_visits').upsert({
    id: visit.id, organization_id: orgId, property_id: lead.property_id, user_id: userId,
    route_session_id: routeId, gps_verified: visit.gpsVerified,
    closest_distance_meters: visit.closestDistanceMeters ?? null,
    reported_action: visit.reportedAction, notes: visit.notes ?? null, visited_at: visit.visitedAt,
  }, { onConflict: 'id' })
  if (error) throw new Error(`Property visit: ${error.message}`)
  await db.put('propertyVisits', { ...visit, syncState: 'synced' })
}
