import { getSupabase } from '../supabase'
import {
  clearOutboxItem,
  listDueOutbox,
  listForeignOutbox,
  listOutbox,
  listStalledOutbox,
  isAuthError,
  markOutboxError,
  setRemoteIdScope,
  unblockAuthOutbox,
} from '../sync-store'
import { recordDrain } from './meta'
import { inspectionResolver } from './resolve'
import { pushObservation, pushPhoto, pushVoiceNote } from './push'
import { pushHandoff } from './handoff'
import { pushLead, pushLeadActivity, pushLeadAttachment } from './leads'
import { POINT_BATCH_SIZE, pushRoutePoint, pushRoutePointBatch, pushRouteSession } from './routes'
import type { OutboxEntity } from '../db'

export interface SyncResult {
  pushed: number
  failed: number
  /** Items that have stopped retrying on their own and need a human. */
  stalled: number
  /** Queued on this device by a different sign-in. Never pushed under this one. */
  foreign: number
  errors: string[]
  skipped: 'offline' | 'no-session' | 'no-membership' | null
}

/**
 * Push order. Inspections first because everything references one; handoffs
 * last because a package must not reach the office before the photos it
 * describes.
 */
const ORDER: Record<OutboxEntity, number> = {
  inspection: 0,
  lead: 0,
  // A session before its points, for the same reason a lead comes before its
  // knocks: a point that arrives first has nothing to belong to.
  routeSession: 0,
  photo: 1,
  observation: 1,
  voiceNote: 1,
  // After its lead, so a knock never arrives before the door it was at.
  leadActivity: 1,
  routePoint: 1,
  // After the activity, so the recording can be filed against the knock it
  // was made during rather than floating loose on the lead.
  leadAttachment: 2,
  handoff: 2,
}

/**
 * Drains the outbox once. Safe to call repeatedly and safe to interrupt: each
 * item is independent, and anything that fails stays queued with its error and
 * a backoff recorded rather than being silently dropped.
 */
export async function syncOutbox(orgId: string | null, userId: string | null): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, failed: 0, stalled: 0, foreign: 0, errors: [], skipped: null }

  // These three return WITHOUT touching the queue on purpose. Being offline,
  // signed out, or not yet in an organisation are not failures of the work —
  // recording them as attempts would spend the retry budget on conditions the
  // rep cannot fix from a driveway, and eventually give up on real doors.
  if (!navigator.onLine) return { ...result, skipped: 'offline', foreign: await countForeign(userId) }
  if (!userId || !getSupabase()) return { ...result, skipped: 'no-session' }
  if (!orgId) return { ...result, skipped: 'no-membership' }

  // Every local-to-remote mapping read or written below belongs to this
  // organisation's database and no other.
  setRemoteIdScope(orgId)

  // There is a session again, so anything parked on a stale token goes back in
  // the queue immediately rather than waiting out a backoff it did not earn.
  await unblockAuthOutbox()

  const due = await listDueOutbox(userId)
  const ordered = [...due]
    .filter((i) => i.entity !== 'routePoint')
    .sort((a, b) => ORDER[a.entity] - ORDER[b.entity])
  // Handled separately, in batches, after everything else. See `drainRoutePoints`.
  const points = due.filter((i) => i.entity === 'routePoint')

  // One resolver per drain: forty photos on one roof resolve the inspection
  // once, not forty times, but the next drain still pushes the rep's latest
  // edits because the cache does not outlive this call.
  const resolve = inspectionResolver(orgId, userId)

  for (const item of ordered) {
    try {
      if (item.entity === 'inspection') await resolve(item.entityId)
      else if (item.entity === 'photo') await pushPhoto(item.entityId, orgId, userId, resolve)
      else if (item.entity === 'observation') await pushObservation(item.entityId, orgId, userId, resolve)
      else if (item.entity === 'voiceNote') await pushVoiceNote(item.entityId, orgId, userId, resolve)
      else if (item.entity === 'handoff') await pushHandoff(item.entityId, orgId, userId, resolve)
      else if (item.entity === 'lead') await pushLead(item.entityId, orgId, userId)
      else if (item.entity === 'leadActivity') await pushLeadActivity(item.entityId, orgId, userId)
      else if (item.entity === 'leadAttachment') await pushLeadAttachment(item.entityId, orgId, userId)
      else if (item.entity === 'routeSession') await pushRouteSession(item.entityId, orgId, userId)
      // routePoint is not handled here; see drainRoutePoints below.
      await clearOutboxItem(item.id)
      result.pushed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markOutboxError(item.id, message)
      result.failed += 1
      if (result.errors.length < 5) result.errors.push(`${item.entity}: ${message}`)
    }
  }

  await drainRoutePoints(points, orgId, userId, result)

  result.stalled = (await listStalledOutbox()).length
  result.foreign = await countForeign(userId)
  recordDrain(result.pushed, result.failed)
  return result
}

/**
 * GPS fixes, many at a time.
 *
 * A rep who worked a street with no signal comes back with hundreds of points.
 * Pushed one by one that is hundreds of round trips on a connection that is
 * barely there, and the queue never empties while the rep watches it not empty.
 *
 * The queue is still one item per point. Only what the server acknowledges is
 * cleared; anything it did not return keeps its item, its error and its
 * backoff, exactly as the single-point path would have left it. A batch that
 * fails outright falls back to pushing its points individually, so one bad
 * fix — a constraint violation, a session that will not resolve — cannot hold
 * ninety-nine good ones hostage.
 */
async function drainRoutePoints(
  items: readonly { id: string; entityId: string; entity: OutboxEntity }[],
  orgId: string,
  userId: string,
  result: SyncResult,
): Promise<void> {
  for (let i = 0; i < items.length; i += POINT_BATCH_SIZE) {
    const chunk = items.slice(i, i + POINT_BATCH_SIZE)
    const byEntityId = new Map(chunk.map((item) => [item.entityId, item.id]))
    try {
      const acknowledged = await pushRoutePointBatch([...byEntityId.keys()], orgId, userId)
      for (const entityId of acknowledged) {
        const itemId = byEntityId.get(entityId)
        if (itemId) await clearOutboxItem(itemId)
        byEntityId.delete(entityId)
        result.pushed += 1
      }
      // Anything the server did not acknowledge is retried on its own next
      // time rather than being marked failed here: a row missing from a
      // returning clause is not the same as a row the server refused.
    } catch (batchError) {
      const batchMessage = batchError instanceof Error ? batchError.message : String(batchError)

      // An expired token will refuse all hundred the same way. Retrying them
      // one at a time would be a hundred pointless requests and, worse, a
      // hundred chances to spend a retry budget on something a sign-in fixes.
      if (isAuthError(batchMessage)) {
        for (const itemId of byEntityId.values()) await markOutboxError(itemId, batchMessage)
        result.failed += byEntityId.size
        if (result.errors.length < 5) result.errors.push(`routePoint: ${batchMessage}`)
        continue
      }

      for (const [entityId, itemId] of byEntityId) {
        try {
          await pushRoutePoint(entityId, orgId, userId)
          await clearOutboxItem(itemId)
          result.pushed += 1
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await markOutboxError(itemId, message)
          result.failed += 1
          if (result.errors.length < 5) result.errors.push(`routePoint: ${message}`)
        }
      }
      if (result.errors.length < 5 && byEntityId.size === 0) {
        result.errors.push(`routePoint batch: ${batchMessage}`)
      }
    }
  }
}

async function countForeign(userId: string | null): Promise<number> {
  return (await listForeignOutbox(userId)).length
}

/** Everything still queued, for the UI that has to explain it to a rep. */
export async function pendingWork(
  currentUserId: string | null = null,
): Promise<{ total: number; stalled: number; foreign: number; blocked: number }> {
  const [all, stalled, foreign] = await Promise.all([
    listOutbox(),
    listStalledOutbox(),
    listForeignOutbox(currentUserId),
  ])
  return {
    total: all.length,
    stalled: stalled.length,
    foreign: foreign.length,
    blocked: all.filter((i) => i.blockedReason === 'auth').length,
  }
}
