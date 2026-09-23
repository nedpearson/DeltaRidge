import { listPoints, readPoint, readSession } from '@/features/routes/route-store'
import { getSupabase } from '../supabase'
import { getRemoteId, setRemoteId } from '../sync-store'
import { pointOrNull } from './resolve'

/**
 * Pushing a rep's own record of when they worked and where they walked.
 *
 * Both writes are UPSERTs on `(organization_id, client_id)` like everything
 * else in this layer, so a retry after a dropped acknowledgement updates rather
 * than duplicating — which matters more here than anywhere: a duplicated GPS
 * point is a place the rep appears to have stood twice.
 */

export async function pushRouteSession(
  localId: string,
  orgId: string,
  userId: string,
): Promise<string> {
  const session = await readSession(localId)
  if (!session) throw new Error('route session missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const { data, error } = await supabase
    .from('route_sessions')
    .upsert(
      {
        organization_id: orgId,
        client_id: session.id,
        // The row is the rep's own. RLS enforces this too; sending it wrong
        // would be refused rather than quietly filed under someone else.
        user_id: userId,
        device_id: session.deviceId,
        label: session.label ?? null,
        started_at: session.startedAt,
        ended_at: session.endedAt ?? null,
        ended_reason: session.endedReason ?? null,
      },
      { onConflict: 'organization_id,client_id' },
    )
    .select('id')
    .single()

  if (error) throw new Error(`route session: ${error.message}`)
  const remoteId = data.id as string
  await setRemoteId('routeSession', localId, remoteId)
  return remoteId
}

export async function pushRoutePoint(localId: string, orgId: string, userId: string): Promise<void> {
  const point = await readPoint(localId)
  if (!point) throw new Error('route point missing locally')

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  // The session has to exist remotely first. Resolved here rather than trusted
  // to queue order, for the same reason a knock resolves its lead: a point
  // whose session failed must not end up attached to nothing.
  const sessionId =
    (await getRemoteId('routeSession', point.sessionId)) ??
    (await pushRouteSession(point.sessionId, orgId, userId))

  const { error } = await supabase.from('route_points').upsert(
    {
      organization_id: orgId,
      client_id: point.id,
      route_session_id: sessionId,
      recorded_at: point.recordedAt,
      location: pointOrNull(point.latitude, point.longitude),
      // Carried through exactly as the device reported it. Nothing downstream
      // may state a position more precisely than this allows.
      accuracy_m: point.accuracyMeters ?? null,
      altitude_m: point.altitudeMeters ?? null,
      speed_mps: point.speedMps ?? null,
      heading_deg: point.headingDeg ?? null,
    },
    { onConflict: 'organization_id,client_id' },
  )

  if (error) throw new Error(`route point: ${error.message}`)
}

/** How much of a session is still on the device, for the sync screen. */
export async function unsyncedPointCount(sessionId: string): Promise<number> {
  const points = await listPoints(sessionId)
  let pending = 0
  for (const p of points) {
    if (!(await getRemoteId('routePoint', p.id))) pending += 1
  }
  return pending
}
