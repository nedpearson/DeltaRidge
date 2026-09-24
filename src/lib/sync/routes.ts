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
        // Breaks the rep took themselves. Stored as given; the server does not
        // infer one from a gap in the trail, because a gap is evidence of
        // nothing and a break is a statement the rep made.
        pauses: session.pauses ?? [],
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

  const { data, error } = await supabase.from('route_points').upsert(
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
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`route point: ${error.message}`)
  // Recorded so `unsyncedPointCount` can tell a rep what is actually still on
  // the phone. Without this it counted every point as pending for ever.
  if (data?.id) await setRemoteId('routePoint', localId, data.id as string)
}

/**
 * Several points in one request.
 *
 * The queue still holds one item per point — that accounting is what the sync
 * screen counts and what survived being proven in the field, and replacing it
 * with opaque chunks would be a second sync framework with its own bugs. What
 * changes is the wire: a rep who was offline for an hour comes back with two
 * hundred fixes, and two hundred round trips over one bar of signal is how a
 * queue never drains. One upsert of two hundred rows is the same idempotent
 * write, done once.
 *
 * Returns the local ids the server acknowledged. A caller clears ONLY those:
 * a partial success must never clear a point the server never took.
 */
export const POINT_BATCH_SIZE = 100

export async function pushRoutePointBatch(
  localIds: readonly string[],
  orgId: string,
  userId: string,
): Promise<string[]> {
  if (localIds.length === 0) return []

  const supabase = getSupabase()
  if (!supabase) throw new Error('not configured')

  const rows: { clientId: string; row: Record<string, unknown> }[] = []
  for (const localId of localIds) {
    const point = await readPoint(localId)
    // A point that is no longer on the device cannot be pushed and must not
    // hold the batch up. It is dropped from this request and its queue item is
    // left alone, so the per-point path reports the real error.
    if (!point) continue

    const sessionId =
      (await getRemoteId('routeSession', point.sessionId)) ??
      (await pushRouteSession(point.sessionId, orgId, userId))

    rows.push({
      clientId: point.id,
      row: {
        organization_id: orgId,
        client_id: point.id,
        route_session_id: sessionId,
        recorded_at: point.recordedAt,
        location: pointOrNull(point.latitude, point.longitude),
        accuracy_m: point.accuracyMeters ?? null,
        altitude_m: point.altitudeMeters ?? null,
        speed_mps: point.speedMps ?? null,
        heading_deg: point.headingDeg ?? null,
      },
    })
  }
  if (rows.length === 0) return []

  const { data, error } = await supabase
    .from('route_points')
    .upsert(
      rows.map((r) => r.row),
      { onConflict: 'organization_id,client_id' },
    )
    .select('id, client_id')

  // The whole statement failed, so nothing was written. Thrown rather than
  // partially reported: the caller retries the batch, and the upsert makes a
  // retry a no-op for anything that did land.
  if (error) throw new Error(`route points: ${error.message}`)

  // Only what came back. A row the server did not return is a row this device
  // cannot claim was stored, and clearing its queue item on optimism is exactly
  // how field work disappears.
  const acknowledged: string[] = []
  for (const row of data ?? []) {
    const clientId = row.client_id as string
    await setRemoteId('routePoint', clientId, row.id as string)
    acknowledged.push(clientId)
  }
  return acknowledged
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
