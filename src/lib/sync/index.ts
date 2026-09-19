import { getSupabase } from '../supabase'
import { clearOutboxItem, listOutbox, markOutboxError } from '../sync-store'
import { ensureInspection } from './resolve'
import { pushObservation, pushPhoto, pushVoiceNote } from './push'

export interface SyncResult {
  pushed: number
  failed: number
  errors: string[]
  skipped: 'offline' | 'no-session' | 'no-membership' | null
}

/**
 * Drains the outbox once. Safe to call repeatedly and safe to interrupt: each
 * item is independent, and anything that fails stays queued with its error
 * recorded rather than being silently dropped.
 */
export async function syncOutbox(orgId: string | null, userId: string | null): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, failed: 0, errors: [], skipped: null }

  if (!navigator.onLine) return { ...result, skipped: 'offline' }
  if (!userId || !getSupabase()) return { ...result, skipped: 'no-session' }
  if (!orgId) return { ...result, skipped: 'no-membership' }

  // Inspections first: everything else references one, and pushing a photo
  // before its inspection would only fail and re-queue.
  const items = await listOutbox()
  const ordered = [
    ...items.filter((i) => i.entity === 'inspection'),
    ...items.filter((i) => i.entity !== 'inspection'),
  ]

  for (const item of ordered) {
    try {
      if (item.entity === 'inspection') await ensureInspection(item.entityId, orgId, userId)
      else if (item.entity === 'photo') await pushPhoto(item.entityId, orgId, userId)
      else if (item.entity === 'observation') await pushObservation(item.entityId, orgId, userId)
      else if (item.entity === 'voiceNote') await pushVoiceNote(item.entityId, orgId, userId)
      await clearOutboxItem(item.id)
      result.pushed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markOutboxError(item.id, message)
      result.failed += 1
      if (result.errors.length < 5) result.errors.push(`${item.entity}: ${message}`)
    }
  }

  return result
}
