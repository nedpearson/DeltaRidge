import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pushing GPS fixes in batches.
 *
 * A rep who worked a street with no signal comes back with hundreds of points.
 * One request per point is hundreds of round trips on a connection that is
 * barely there, and the queue never empties while the rep watches it not empty.
 *
 * The risk in batching is the obvious one: clearing a hundred queue items on
 * one response that only covered ninety. So the only thing that matters here is
 * that the function reports exactly what the server acknowledged, and nothing
 * else.
 */

const points = new Map<string, { id: string; sessionId: string; recordedAt: string; latitude: number; longitude: number; accuracyMeters?: number }>()
const remoteIds = new Map<string, string>()
let response: { data: { id: string; client_id: string }[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
}
let lastRows: Record<string, unknown>[] = []

vi.mock('@/features/routes/route-store', () => ({
  readPoint: vi.fn(async (id: string) => points.get(id) ?? null),
  readSession: vi.fn(async () => ({ id: 'sess-1', startedAt: '2026-09-23T14:00:00Z', deviceId: 'd' })),
  listPoints: vi.fn(async () => [...points.values()]),
}))

vi.mock('@/lib/sync-store', () => ({
  getRemoteId: vi.fn(async (entity: string, localId: string) => remoteIds.get(`${entity}:${localId}`) ?? null),
  setRemoteId: vi.fn(async (entity: string, localId: string, remoteId: string) => {
    remoteIds.set(`${entity}:${localId}`, remoteId)
  }),
}))

vi.mock('@/lib/sync/resolve', () => ({ pointOrNull: vi.fn(() => null) }))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      upsert: (rows: Record<string, unknown>[]) => {
        lastRows = Array.isArray(rows) ? rows : [rows]
        return { select: async () => response }
      },
    }),
  }),
}))

function seed(n: number): string[] {
  const ids: string[] = []
  for (let i = 0; i < n; i += 1) {
    const id = `p-${i}`
    points.set(id, {
      id,
      sessionId: 'sess-1',
      recordedAt: new Date(Date.parse('2026-09-23T14:00:00Z') + i * 20_000).toISOString(),
      latitude: 30.4 + i / 100_000,
      longitude: -91.1,
      accuracyMeters: 9,
    })
    ids.push(id)
  }
  return ids
}

describe('pushRoutePointBatch', () => {
  beforeEach(() => {
    points.clear()
    remoteIds.clear()
    remoteIds.set('routeSession:sess-1', 'sess-remote')
    lastRows = []
  })

  it('sends every point in one request', async () => {
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    const ids = seed(40)
    response = { data: ids.map((id) => ({ id: `remote-${id}`, client_id: id })), error: null }

    const acknowledged = await pushRoutePointBatch(ids, 'org-1', 'user-1')

    expect(lastRows).toHaveLength(40)
    expect(acknowledged).toHaveLength(40)
  })

  it('reports only what the server actually returned', async () => {
    // A partial response is not permission to clear the rest. Clearing a queue
    // item for a row the server never took is how a day of field work
    // disappears with nothing to show it ever existed.
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    const ids = seed(10)
    response = {
      data: ids.slice(0, 6).map((id) => ({ id: `remote-${id}`, client_id: id })),
      error: null,
    }

    const acknowledged = await pushRoutePointBatch(ids, 'org-1', 'user-1')

    expect(acknowledged).toHaveLength(6)
    expect(acknowledged).not.toContain('p-7')
  })

  it('records the mapping for every acknowledged point', async () => {
    // Without this, the sync panel counted every point as still pending for
    // ever, which reads to a rep as "my route never sent".
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    const ids = seed(3)
    response = { data: ids.map((id) => ({ id: `remote-${id}`, client_id: id })), error: null }

    await pushRoutePointBatch(ids, 'org-1', 'user-1')

    expect(remoteIds.get('routePoint:p-0')).toBe('remote-p-0')
    expect(remoteIds.get('routePoint:p-2')).toBe('remote-p-2')
  })

  it('throws rather than half-reporting when the whole statement fails', async () => {
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    const ids = seed(5)
    response = { data: null, error: { message: 'JWT expired' } }

    await expect(pushRoutePointBatch(ids, 'org-1', 'user-1')).rejects.toThrow(/JWT expired/)
  })

  it('skips a point that is no longer on the device instead of failing the batch', async () => {
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    const ids = seed(3)
    points.delete('p-1')
    response = {
      data: ['p-0', 'p-2'].map((id) => ({ id: `remote-${id}`, client_id: id })),
      error: null,
    }

    const acknowledged = await pushRoutePointBatch(ids, 'org-1', 'user-1')
    expect(lastRows).toHaveLength(2)
    expect(acknowledged).toEqual(['p-0', 'p-2'])
  })

  it('does nothing at all for an empty batch', async () => {
    const { pushRoutePointBatch } = await import('@/lib/sync/routes')
    expect(await pushRoutePointBatch([], 'org-1', 'user-1')).toEqual([])
    expect(lastRows).toHaveLength(0)
  })
})
