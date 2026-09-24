import { describe, expect, it } from 'vitest'
import { FLUSH_BATCH, KEEP_DAYS, planFlush } from '@/features/observability/trace-store'
import type { LocalTraceStep } from '@/lib/db'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const MINE = '5c28ed21-f768-44fc-b955-6c440bb1f864'
const THEIRS = '00000000-0000-4000-8000-000000000999'

const step = (over: Partial<LocalTraceStep> = {}): LocalTraceStep => ({
  id: 'a',
  traceId: 'tr_0123456789ABCDEF',
  layer: 'outbox',
  step: 'outbox.queued',
  outcome: 'started',
  deviceAt: '2026-09-23T08:00:00Z',
  userId: MINE,
  orgId: 'org',
  ...over,
})

const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

describe("another rep's steps", () => {
  it('are held, never sent', () => {
    /*
     * The insert policy pins actor to auth.uid(), so a foreign step would be
     * refused — and a refused insert retries forever. A field phone gets handed
     * between reps, so this is the ordinary case, not an edge one.
     */
    const plan = planFlush([step({ id: 'x', userId: THEIRS })], MINE, NOW)
    expect(plan.send).toHaveLength(0)
    expect(plan.heldForeign).toBe(1)
    expect(plan.dropStale).toHaveLength(0)
  })

  it('does not stop the signed-in rep from sending their own', () => {
    const plan = planFlush(
      [step({ id: 'mine' }), step({ id: 'theirs', userId: THEIRS })],
      MINE,
      NOW,
    )
    expect(plan.send.map((s) => s.id)).toEqual(['mine'])
  })

  it('treats a step captured with nobody signed in as claimable', () => {
    // Same rule as the outbox: work captured before sign-in belongs to the
    // device, and the person signing in on that device is who knocked.
    expect(planFlush([step({ userId: null })], MINE, NOW).send).toHaveLength(1)
    // And a step written before the field existed at all.
    const legacy: LocalTraceStep = {
      id: 'legacy',
      traceId: 'tr_0123456789ABCDEF',
      layer: 'outbox',
      step: 'outbox.queued',
      outcome: 'started',
      deviceAt: '2026-09-23T08:00:00Z',
    }
    expect(planFlush([legacy], MINE, NOW).send).toHaveLength(1)
  })
})

describe('stale steps', () => {
  it('are dropped rather than retried forever', () => {
    const plan = planFlush([step({ id: 'old', deviceAt: daysAgo(KEEP_DAYS + 1) })], MINE, NOW)
    expect(plan.send).toHaveLength(0)
    expect(plan.dropStale.map((s) => s.id)).toEqual(['old'])
  })

  it('keeps one that is just inside the window', () => {
    expect(planFlush([step({ deviceAt: daysAgo(KEEP_DAYS - 1) })], MINE, NOW).send).toHaveLength(1)
  })

  it('drops a step whose timestamp cannot be read', () => {
    // It cannot be ordered, so it would sit in the buffer forever.
    const plan = planFlush([step({ id: 'bad', deviceAt: 'whenever' })], MINE, NOW)
    expect(plan.dropStale.map((s) => s.id)).toEqual(['bad'])
    expect(plan.send).toHaveLength(0)
  })
})

describe('ordering and batching', () => {
  it('sends oldest first, so a partial flush leaves no holes', () => {
    const plan = planFlush(
      [
        step({ id: 'late', deviceAt: '2026-09-23T10:00:00Z' }),
        step({ id: 'early', deviceAt: '2026-09-23T06:00:00Z' }),
        step({ id: 'middle', deviceAt: '2026-09-23T08:00:00Z' }),
      ],
      MINE,
      NOW,
    )
    expect(plan.send.map((s) => s.id)).toEqual(['early', 'middle', 'late'])
  })

  it('caps a batch so a week of backlog does not stall a drain', () => {
    const many = Array.from({ length: FLUSH_BATCH + 50 }, (_, i) =>
      step({ id: `s${i}`, deviceAt: new Date(NOW - (FLUSH_BATCH + 50 - i) * 1000).toISOString() }),
    )
    const plan = planFlush(many, MINE, NOW)
    expect(plan.send).toHaveLength(FLUSH_BATCH)
    // And it takes the oldest, not an arbitrary slice.
    expect(plan.send[0]?.id).toBe('s0')
  })
})

describe('nothing to do', () => {
  it('plans nothing from an empty buffer', () => {
    const plan = planFlush([], MINE, NOW)
    expect(plan.send).toHaveLength(0)
    expect(plan.dropStale).toHaveLength(0)
    expect(plan.heldForeign).toBe(0)
  })
})
