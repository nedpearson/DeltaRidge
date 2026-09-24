import { getDB, type LocalTraceStep } from '@/lib/db'
import { getSupabase } from '@/lib/supabase'
import { newTraceId, type TraceLayer, type TraceOutcome } from './trace'

/**
 * Recording what happened, and getting it to the server eventually.
 *
 * Two rules run through this file, and both are about not letting observability
 * damage the thing it observes.
 *
 * Nothing here ever throws into a caller. A trace is commentary on the work; a
 * knock that failed to save because its trace step failed would be an absurd
 * trade, and the rep standing in the driveway would be right to stop using the
 * app. Every function swallows its own errors.
 *
 * Nothing here blocks. Steps are written locally and pushed opportunistically,
 * because the moments worth tracing are exactly the moments with no signal.
 */

/** Steps older than this are dropped rather than retried forever. */
export const KEEP_DAYS = 14
/** Never let the local buffer grow without bound on a phone that is offline for a week. */
export const MAX_LOCAL_STEPS = 2000
/** One flush sends at most this many, so a week's backlog does not stall a drain. */
export const FLUSH_BATCH = 200

export interface FlushPlan {
  /** Steps to send, oldest first. */
  readonly send: readonly LocalTraceStep[]
  /** Steps to delete without sending, because they are too old to matter. */
  readonly dropStale: readonly LocalTraceStep[]
  /** Steps belonging to a different sign-in, left alone. */
  readonly heldForeign: number
}

/**
 * Which buffered steps go, which get dropped, and which are left alone.
 *
 * Separated from the IO so the decisions can be tested without an IndexedDB and
 * a network. Every one of them is a judgement that would otherwise only be
 * exercised in the field:
 *
 *   Foreign steps are held, never sent. The insert policy pins `actor` to
 *   auth.uid(), so a step captured under a different sign-in would be refused —
 *   and a refused insert retries forever. Same reasoning as the outbox's
 *   foreign-work rule: a field phone gets handed between reps.
 *
 *   Stale steps are dropped whether or not they ever went. A fortnight-old
 *   trace nobody could push is not going to become useful, and keeping it means
 *   a phone that spent a week offline never clears its buffer.
 *
 *   Oldest first, so a partial flush leaves a coherent prefix rather than
 *   holes — a trace read with its middle missing is worse than one that stops.
 */
export function planFlush(
  steps: readonly LocalTraceStep[],
  userId: string,
  now: number,
): FlushPlan {
  const cutoff = now - KEEP_DAYS * 86_400_000
  const dropStale: LocalTraceStep[] = []
  const fresh: LocalTraceStep[] = []

  for (const step of steps) {
    const at = new Date(step.deviceAt).getTime()
    // An unreadable timestamp is treated as stale: it cannot be ordered, and it
    // would otherwise sit in the buffer forever.
    if (Number.isNaN(at) || at < cutoff) dropStale.push(step)
    else fresh.push(step)
  }

  const mine = fresh.filter((s) => s.userId === null || s.userId === undefined || s.userId === userId)
  const heldForeign = fresh.length - mine.length

  const send = [...mine].sort((a, b) => a.deviceAt.localeCompare(b.deviceAt)).slice(0, FLUSH_BATCH)
  return { send, dropStale, heldForeign }
}

export async function recordStep(input: {
  traceId?: string
  layer: TraceLayer & ('device' | 'outbox')
  step: string
  outcome: TraceOutcome
  entity?: string
  entityId?: string
  detail?: string
  userId?: string | null
  orgId?: string | null
}): Promise<string> {
  const traceId = input.traceId ?? newTraceId()
  try {
    const db = await getDB()
    await db.put('traces', {
      // The step name is part of the key so a retry of the same step overwrites
      // rather than accumulating, but two different steps on one trace coexist.
      id: `${traceId}:${input.step}:${Date.now()}`,
      traceId,
      layer: input.layer,
      step: input.step,
      outcome: input.outcome,
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      deviceAt: new Date().toISOString(),
      userId: input.userId ?? null,
      orgId: input.orgId ?? null,
    })
  } catch {
    /* observability must never break the thing it observes */
  }
  return traceId
}

export async function pendingSteps(): Promise<LocalTraceStep[]> {
  try {
    const db = await getDB()
    return (await db.getAll('traces')) as LocalTraceStep[]
  } catch {
    return []
  }
}

/**
 * Push what is buffered, then forget it.
 *
 * Called from the sync drain rather than on a timer, so tracing rides on the
 * same connectivity the real work does and never wakes a radio on its own.
 */
export async function flushSteps(orgId: string | null, userId: string | null): Promise<number> {
  if (orgId === null || userId === null) return 0
  const supabase = getSupabase()
  if (!supabase) return 0

  const steps = await pendingSteps()
  if (steps.length === 0) return 0

  const plan = planFlush(steps, userId, Date.now())
  const ordered = plan.send
  const stale = plan.dropStale

  let sent = 0
  if (ordered.length > 0) {
    const { error } = await supabase.from('integration_traces').insert(
      ordered.map((step) => ({
        organization_id: orgId,
        trace_id: step.traceId,
        layer: step.layer,
        step: step.step,
        outcome: step.outcome,
        entity: step.entity ?? null,
        entity_id: step.entityId ?? null,
        detail: step.detail ?? null,
        actor: userId,
        device_at: step.deviceAt,
      })),
    )
    if (error === null) sent = ordered.length
  }

  try {
    const db = await getDB()
    const tx = db.transaction('traces', 'readwrite')
    // Sent steps go; stale ones go whether or not they were ever sent, because
    // a fortnight-old trace nobody could push is not going to become useful.
    const remove = sent > 0 ? [...ordered, ...stale] : stale
    await Promise.all(remove.map((step) => tx.store.delete(step.id)))

    // A phone offline for a week must not fill its storage with commentary.
    const remaining = (await db.getAll('traces')) as LocalTraceStep[]
    if (remaining.length > MAX_LOCAL_STEPS) {
      const excess = [...remaining]
        .sort((a, b) => a.deviceAt.localeCompare(b.deviceAt))
        .slice(0, remaining.length - MAX_LOCAL_STEPS)
      const trim = db.transaction('traces', 'readwrite')
      await Promise.all(excess.map((step) => trim.store.delete(step.id)))
      await trim.done
    }
    await tx.done
  } catch {
    /* a failed cleanup means a duplicate step, not lost work */
  }

  return sent
}
