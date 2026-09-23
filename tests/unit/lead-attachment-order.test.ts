import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A photo has to be filed against the knock it was taken during.
 *
 * The defect this covers was silent and permanent. `pushLeadAttachment` read
 * the id map for the activity, accepted `null` when the knock had not synced
 * yet, wrote `activity_id: null`, and — because the upload itself succeeded —
 * the outbox item was cleared. Nothing ever went back to repair the link. The
 * office kept the photo and lost what it was evidence of.
 *
 * So the assertion is not "it did not crash". It is that the row carries a real
 * activity id, and that the activity was pushed first to produce one.
 */

const ATTACHMENT = {
  id: 'att-1',
  leadId: 'lead-1',
  eventId: 'evt-1',
  kind: 'photo' as const,
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  byteSize: 1,
  capturedAt: '2026-09-23T14:05:00.000Z',
}

const EVENT = {
  id: 'evt-1',
  leadId: 'lead-1',
  kind: 'door_knock' as const,
  at: '2026-09-23T14:04:00.000Z',
  outcome: 'spoke',
}

const LEAD = { id: 'lead-1', latitude: 30.4, longitude: -91.1 }

const calls: { order: string[]; rows: Record<string, Record<string, unknown>> } = { order: [], rows: {} }
const remoteIds = new Map<string, string>()

vi.mock('@/features/leads/lead-store', () => ({
  readAttachment: vi.fn(async () => ATTACHMENT),
  readEvent: vi.fn(async () => EVENT),
  readLead: vi.fn(async () => LEAD),
}))

vi.mock('@/lib/sync-store', () => ({
  getRemoteId: vi.fn(async (entity: string, localId: string) => remoteIds.get(`${entity}:${localId}`) ?? null),
  setRemoteId: vi.fn(async (entity: string, localId: string, remoteId: string) => {
    remoteIds.set(`${entity}:${localId}`, remoteId)
  }),
}))

vi.mock('@/lib/sync/resolve', () => ({
  ensurePropertyFor: vi.fn(async () => 'prop-remote'),
  pointOrNull: vi.fn(() => null),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: vi.fn(async () => {
          calls.order.push('upload')
          return { error: null }
        }),
      }),
    },
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        calls.order.push(table)
        calls.rows[table] = row
        return {
          select: () => ({ single: async () => ({ data: { id: `${table}-remote` }, error: null }) }),
        }
      },
      insert: (row: Record<string, unknown>) => {
        calls.order.push(table)
        calls.rows[table] = row
        return {
          select: () => ({ single: async () => ({ data: { id: `${table}-remote` }, error: null }) }),
        }
      },
    }),
  }),
}))

const ORG = 'org-1'
const USER = 'user-1'

describe('pushLeadAttachment', () => {
  beforeEach(() => {
    calls.order = []
    calls.rows = {}
    remoteIds.clear()
  })

  it('pushes the knock first when it has not synced, and links the photo to it', async () => {
    const { pushLeadAttachment } = await import('@/lib/sync/leads')
    remoteIds.set('lead:lead-1', 'lead-remote')

    await pushLeadAttachment('att-1', ORG, USER)

    expect(calls.order.indexOf('activities')).toBeGreaterThan(-1)
    expect(calls.order.indexOf('activities')).toBeLessThan(calls.order.indexOf('lead_attachments'))
    expect(calls.rows.lead_attachments?.activity_id).toBe('activities-remote')
  })

  it('never writes a null activity link for an attachment that has a knock', async () => {
    const { pushLeadAttachment } = await import('@/lib/sync/leads')
    remoteIds.set('lead:lead-1', 'lead-remote')

    await pushLeadAttachment('att-1', ORG, USER)

    // The exact shape of the old bug.
    expect(calls.rows.lead_attachments?.activity_id).not.toBeNull()
  })

  it('reuses an already-synced knock instead of pushing it twice', async () => {
    const { pushLeadAttachment } = await import('@/lib/sync/leads')
    remoteIds.set('lead:lead-1', 'lead-remote')
    remoteIds.set('leadActivity:evt-1', 'activity-already-there')

    await pushLeadAttachment('att-1', ORG, USER)

    expect(calls.order).not.toContain('activities')
    expect(calls.rows.lead_attachments?.activity_id).toBe('activity-already-there')
  })
})
