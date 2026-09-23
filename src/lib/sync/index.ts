import { getSupabase } from '../supabase'
import {
  clearOutboxItem,
  listDueOutbox,
  listForeignOutbox,
  listOutbox,
  listStalledOutbox,
  markOutboxError,
  setRemoteIdScope,
  unblockAuthOutbox,
} from '../sync-store'
import { recordDrain } from './meta'
import { inspectionResolver } from './resolve'
import { pushObservation, pushPhoto, pushVoiceNote } from './push'
import { pushHandoff } from './handoff'
import { pushLead, pushLeadActivity, pushLeadAttachment } from './leads'
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
  photo: 1,
  observation: 1,
  voiceNote: 1,
  // After its lead, so a knock never arrives before the door it was at.
  leadActivity: 1,
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
  const ordered = [...due].sort((a, b) => ORDER[a.entity] - ORDER[b.entity])

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
      await clearOutboxItem(item.id)
      result.pushed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markOutboxError(item.id, message)
      result.failed += 1
      if (result.errors.length < 5) result.errors.push(`${item.entity}: ${message}`)
    }
  }

  result.stalled = (await listStalledOutbox()).length
  result.foreign = await countForeign(userId)
  recordDrain(result.pushed, result.failed)
  return result
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
