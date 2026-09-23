import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DbModule from '@/lib/db'
import { openDB } from 'idb'
import {
  listPoints,
  openSession,
  recordPoint,
  startSession,
  stopSession,
} from '@/features/routes/route-store'

/**
 * The privacy guarantee this feature rests on is not a policy, it is a refusal
 * in code: a location cannot be recorded without an open session, and only the
 * rep opens or closes one.
 *
 * Tested against a real IndexedDB rather than a mock, because "the store
 * refuses" is the claim, and a mocked store would only prove that the test
 * agrees with itself.
 */

const queued: Array<{ entity: string; id: string }> = []

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof DbModule>('@/lib/db')
  return {
    ...actual,
    newId: () => `id-${Math.random().toString(36).slice(2)}`,
    queueSync: async (entity: string, id: string) => {
      queued.push({ entity, id })
    },
  }
})

async function wipe(): Promise<void> {
  const db = await openDB('delta-ridge-routes', 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('sessions')) {
        d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-started', 'startedAt')
      }
      if (!d.objectStoreNames.contains('points')) {
        d.createObjectStore('points', { keyPath: 'id' }).createIndex('by-session', 'sessionId')
      }
    },
  })
  await db.clear('sessions')
  await db.clear('points')
  db.close()
}

const T0 = '2026-09-23T14:00:00.000Z'
const T1 = '2026-09-23T16:30:00.000Z'

function fix(recordedAt: string) {
  return { recordedAt, latitude: 30.4515, longitude: -91.1871, accuracyMeters: 8 }
}

describe('route sessions', () => {
  beforeEach(async () => {
    await wipe()
    queued.length = 0
  })

  it('records a point inside an open session', async () => {
    const session = await startSession(T0)
    expect(await recordPoint(session.id, fix(T0))).not.toBeNull()
    expect(await listPoints(session.id)).toHaveLength(1)
  })

  it('refuses to record a location after the rep has stopped', async () => {
    // The load-bearing refusal. Without it this module could record somebody's
    // location at any time, and a later caller would eventually do so by
    // mistake rather than by design.
    const session = await startSession(T0)
    await stopSession(session.id, T1)
    expect(await recordPoint(session.id, fix(T1))).toBeNull()
    expect(await listPoints(session.id)).toHaveLength(0)
  })

  it('refuses to record a location against a session that does not exist', async () => {
    expect(await recordPoint('never-started', fix(T0))).toBeNull()
  })

  it('reports no open session before the rep starts one', async () => {
    // Nothing opens a session on mount, on sign-in, or on app launch.
    expect(await openSession()).toBeNull()
  })

  it('finds an open session again after a reload', async () => {
    const session = await startSession(T0)
    expect((await openSession())?.id).toBe(session.id)
  })

  it('does not treat a stopped session as open', async () => {
    const session = await startSession(T0)
    await stopSession(session.id, T1)
    expect(await openSession()).toBeNull()
  })

  it('treats a second stop as the same stop, not a new one', async () => {
    // A rep who taps stop twice has stopped once. Overwriting would move the
    // end of their work day to whenever they tapped again.
    const session = await startSession(T0)
    const first = await stopSession(session.id, T1)
    const second = await stopSession(session.id, '2026-09-23T18:00:00.000Z')
    expect(second?.endedAt).toBe(first?.endedAt)
  })

  it('queues the session and every point through the shared outbox', async () => {
    // Not a separate uploader. A route is field work and rides the same queue,
    // retry schedule and diagnostics as a knock.
    const session = await startSession(T0)
    await recordPoint(session.id, fix(T0))
    await stopSession(session.id, T1)

    expect(queued.filter((q) => q.entity === 'routeSession')).toHaveLength(2)
    expect(queued.filter((q) => q.entity === 'routePoint')).toHaveLength(1)
  })

  it('keeps points in the order they were recorded', async () => {
    const session = await startSession(T0)
    await recordPoint(session.id, fix('2026-09-23T14:10:00.000Z'))
    await recordPoint(session.id, fix('2026-09-23T14:05:00.000Z'))
    const points = await listPoints(session.id)
    expect(points.map((p) => p.recordedAt)).toEqual([
      '2026-09-23T14:05:00.000Z',
      '2026-09-23T14:10:00.000Z',
    ])
  })
})
