import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_REMOTE_STATUSES, localContactKind, localLeadStatus } from '@/lib/sync/pull'
import { remoteLeadStatus } from '@/lib/sync/leads'
import { asDoorOutcome } from '@/features/leads/pipeline'
import type { LeadStatus } from '@/features/leads/pipeline'

/**
 * Reading the server back is where a sync layer usually starts lying. Pushing
 * only ever adds; pulling can overwrite, and every one of these cases is a way
 * the office's record and the rep's phone can disagree.
 */

describe('localLeadStatus', () => {
  it('round-trips every status a rep can actually set', () => {
    // The door sheet's own vocabulary must survive a trip through the office
    // and back unchanged, or a lead changes status by being synced.
    const settable: LeadStatus[] = [
      'attempted',
      'reached',
      'interested',
      'inspection_requested',
      'appointment',
      'inspected',
      'not_interested',
      'do_not_knock',
    ]
    for (const status of settable) {
      expect(localLeadStatus(remoteLeadStatus(status)), status).toBe(status)
    }
  })

  it('normalizes legacy local aliases into the current canonical field vocabulary', () => {
    expect(localLeadStatus(remoteLeadStatus('follow_up'))).toBe('reached')
    expect(localLeadStatus(remoteLeadStatus('need_visit'))).toBe('inspection_requested')
  })

  it('shows an office-only outcome as the nearest thing a door sheet can say', () => {
    expect(localLeadStatus('sold')).toBe('won')
    expect(localLeadStatus('proposal_pending')).toBe('estimate_proposal')
    expect(localLeadStatus('existing_customer')).toBe('customer')
    // 'lost' is written both for a refusal and for a door that was never a
    // prospect. It shows as the weaker of the two so a rep is not told somebody
    // turned them down when the roof was simply already new.
    expect(localLeadStatus('lost')).toBe('disqualified')
  })

  it('treats a status this build has never heard of as nothing having happened', () => {
    // A later migration adding an enum value must not be read as an outcome.
    expect(localLeadStatus('renegotiating')).toBe('new')
    expect(localLeadStatus('')).toBe('new')
  })

  it('never downgrades do_not_contact into something contactable', () => {
    expect(localLeadStatus('do_not_contact')).toBe('do_not_knock')
  })
})

describe('TERMINAL_REMOTE_STATUSES', () => {
  it('covers every office status the door sheet cannot express', () => {
    // These are office-owned statuses. Even when the local UI can display an
    // equivalent state, the field device must not overwrite the office outcome.
    for (const status of ['sold', 'lost', 'proposal_pending', 'existing_customer']) {
      expect(TERMINAL_REMOTE_STATUSES.has(status), status).toBe(true)
    }
  })

  it('does not lock statuses a rep is supposed to be able to move', () => {
    for (const status of ['target', 'no_answer', 'spoke', 'appointment', 'inspected']) {
      expect(TERMINAL_REMOTE_STATUSES.has(status), status).toBe(false)
    }
  })
})

describe('asDoorOutcome', () => {
  it('accepts the outcomes the door sheet defines', () => {
    expect(asDoorOutcome('no_answer')).toBe('no_answer')
    expect(asDoorOutcome('do_not_knock')).toBe('do_not_knock')
  })

  it('drops anything else rather than casting it', () => {
    // `activities.outcome` is free text. A value from the office or a future
    // integration must not end up driving the door sheet's status rules.
    expect(asDoorOutcome('left_flyer')).toBeNull()
    expect(asDoorOutcome('')).toBeNull()
    expect(asDoorOutcome(null)).toBeNull()
  })
})

describe('localContactKind', () => {
  it('keeps the distinction between what was attempted and what happened', () => {
    // 'call' in the database is a placed call. Reading it back as anything
    // stronger would turn an unanswered dial into a conversation.
    expect(localContactKind('call')).toBe('call_placed')
    expect(localContactKind('text')).toBe('text_initiated')
    expect(localContactKind('door_knock')).toBe('door_knock')
  })

  it('files an unknown activity type as a note rather than a contact', () => {
    expect(localContactKind('status_change')).toBe('note')
    expect(localContactKind('handoff')).toBe('note')
  })
})

/**
 * The guard that makes the pull safe to have at all: once the office owns a
 * lead's status, the phone stops sending one.
 */
const pushed: Record<string, Record<string, unknown>> = {}

vi.mock('@/features/leads/lead-store', () => ({
  readAttachment: vi.fn(),
  readEvent: vi.fn(),
  readLead: vi.fn(async (id: string) => leadFixture(id)),
}))

vi.mock('@/lib/sync-store', () => ({
  getRemoteId: vi.fn(async () => null),
  setRemoteId: vi.fn(async () => undefined),
}))

vi.mock('@/lib/sync/resolve', () => ({
  ensurePropertyFor: vi.fn(async () => 'prop-remote'),
  pointOrNull: vi.fn(() => null),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        pushed[table] = row
        return { select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }
      },
    }),
  }),
}))

let fixtureStatus: LeadStatus = 'inspected'
let fixtureRemoteStatus: string | undefined

function leadFixture(id: string) {
  return {
    id,
    addressKey: '123 oak st',
    address: '123 Oak St',
    latitude: 30.4,
    longitude: -91.1,
    score: 60,
    reasons: [],
    status: fixtureStatus,
    ...(fixtureRemoteStatus ? { remoteStatus: fixtureRemoteStatus } : {}),
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
    knockCount: 1,
  }
}

describe('pushLead status ownership', () => {
  beforeEach(() => {
    for (const key of Object.keys(pushed)) delete pushed[key]
    fixtureStatus = 'inspected'
    fixtureRemoteStatus = undefined
  })

  it('sends the status for a lead the office has not closed out', async () => {
    const { pushLead } = await import('@/lib/sync/leads')
    await pushLead('lead-1', 'org-1', 'user-1')
    expect(pushed.leads?.status).toBe('inspected')
  })

  it('does not walk a sold job back to inspected', async () => {
    // The exact loss this guard exists for: there is no sold button at a door,
    // so the phone's honest 'inspected' would overwrite the real outcome.
    const { pushLead } = await import('@/lib/sync/leads')
    fixtureRemoteStatus = 'sold'
    await pushLead('lead-1', 'org-1', 'user-1')
    expect(pushed.leads).toBeDefined()
    expect('status' in (pushed.leads ?? {})).toBe(false)
  })

  it('still sends everything else about a closed-out lead', async () => {
    const { pushLead } = await import('@/lib/sync/leads')
    fixtureRemoteStatus = 'sold'
    await pushLead('lead-1', 'org-1', 'user-1')
    expect(pushed.leads?.client_id).toBe('lead-1')
    expect(pushed.leads?.opportunity_score).toBe(60)
  })
})

/**
 * Two gaps the live round-trip rehearsal found, both silent.
 *
 * `lead_sync_rows` and `activity_sync_rows` were written before `subdivision`
 * and the GPS columns existed, so a device that PULLED a lead rather than
 * generating it got a door with no neighbourhood and a knock with no evidence.
 * Neither failed; both just quietly lost information that the server had.
 */
describe('asVerificationRecord', () => {
  it('carries a verdict the server recorded', async () => {
    const { asVerificationRecord } = await import('@/lib/sync/pull')
    expect(
      asVerificationRecord({ gps_verification: 'verified', gps_distance_m: 11, gps_accuracy_m: 9 }),
    ).toEqual({ verification: 'verified', distanceMeters: 11, accuracyMeters: 9 })
  })

  it('keeps a verdict that has no distance attached to it', async () => {
    const { asVerificationRecord } = await import('@/lib/sync/pull')
    expect(
      asVerificationRecord({
        gps_verification: 'gps_unavailable',
        gps_distance_m: null,
        gps_accuracy_m: null,
      }),
    ).toEqual({ verification: 'gps_unavailable' })
  })

  it('drops a class this build does not recognise rather than displaying it', async () => {
    // A word from a later migration shown to a manager as though it meant
    // something is worse than showing nothing.
    const { asVerificationRecord } = await import('@/lib/sync/pull')
    expect(
      asVerificationRecord({ gps_verification: 'maybe', gps_distance_m: 1, gps_accuracy_m: 1 }),
    ).toBeNull()
  })

  it('treats a missing verdict as no evidence rather than a bad one', async () => {
    const { asVerificationRecord } = await import('@/lib/sync/pull')
    expect(
      asVerificationRecord({ gps_verification: null, gps_distance_m: null, gps_accuracy_m: null }),
    ).toBeNull()
  })
})
