import { describe, expect, it } from 'vitest'
import {
  DOOR_OUTCOMES,
  OUTCOME_LABEL,
  applyOutcome,
  asDoorOutcome,
  isConversation,
  isDisqualifying,
  isKnock,
  type DoorOutcome,
  type ManagedLead,
} from '@/features/leads/pipeline'
import { remoteLeadStatus } from '@/lib/sync/leads'

/**
 * The door vocabulary grew from seven words to thirteen, and every one of them
 * feeds a number somebody will eventually be judged by. These tests are about
 * the two places that judgement goes wrong: counting a door hanger as a
 * conversation, and filing a roof that was already new as a rejection.
 */

const BASE: ManagedLead = {
  id: 'lead-1',
  addressKey: '18818-bella-vista',
  address: '18818 BELLA VISTA CT',
  latitude: 30.4,
  longitude: -91.1,
  score: 62,
  reasons: ['hail'],
  status: 'new',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  knockCount: 0,
}

const ALL = [...DOOR_OUTCOMES] as DoorOutcome[]

describe('the outcome vocabulary', () => {
  it('has a label and a rule for every outcome, with nothing orphaned', () => {
    for (const outcome of ALL) {
      expect(OUTCOME_LABEL[outcome], outcome).toBeTruthy()
      // Throws if there is no rule, which is the failure this catches.
      expect(typeof isKnock(outcome)).toBe('boolean')
    }
    expect(ALL).toHaveLength(14)
  })

  it('refuses a word it does not know rather than casting it', () => {
    expect(asDoorOutcome('left_flyer')).toBeNull()
    expect(asDoorOutcome('')).toBeNull()
    expect(asDoorOutcome(null)).toBeNull()
    expect(asDoorOutcome('roof_replaced')).toBe('roof_replaced')
  })
})

describe('what counts as somebody having engaged', () => {
  it('does not count a door hanger, an empty house or a finished roof', () => {
    // The old rule was `outcome !== 'no_answer'`, which counted all three and
    // inflated contact rate — the figure the grading engine leans on hardest.
    expect(isConversation('left_info')).toBe(false)
    expect(isConversation('vacant')).toBe(false)
    expect(isConversation('roof_replaced')).toBe(false)
    expect(isConversation('no_answer')).toBe(false)
    expect(isConversation('other')).toBe(false)
  })

  it('counts the ones where a person actually came to the door', () => {
    expect(isConversation('spoke')).toBe(true)
    expect(isConversation('renter')).toBe(true)
    expect(isConversation('not_interested')).toBe(true)
    expect(isConversation('wants_inspection')).toBe(true)
  })

  it('still counts the visit as a knock even when nobody engaged', () => {
    // The rep stood there. Effort and contact are different questions and the
    // performance screens ask them separately.
    expect(isKnock('left_info')).toBe(true)
    expect(isKnock('vacant')).toBe(true)
    expect(isKnock('no_answer')).toBe(true)
    // Recorded from the list without a visit.
    expect(isKnock('do_not_knock')).toBe(false)
  })
})

describe('doors that were never prospects', () => {
  it('separates them from refusals', () => {
    expect(isDisqualifying('roof_replaced')).toBe(true)
    expect(isDisqualifying('vacant')).toBe(true)
    expect(isDisqualifying('not_interested')).toBe(false)
  })

  it('maps to lost rather than not_interested on the server', () => {
    // A future campaign must not treat an already-new roof as somebody who
    // said no to us.
    expect(remoteLeadStatus('disqualified')).toBe('lost')
    expect(remoteLeadStatus('not_interested')).toBe('not_interested')
  })

  it('clears a booked appointment when the door turns out not to be one', () => {
    const booked: ManagedLead = {
      ...BASE,
      status: 'appointment',
      appointmentAt: '2026-09-25T15:00:00.000Z',
      appointmentClientId: 'appt-1',
    }
    const { lead } = applyOutcome(booked, 'vacant', '2026-09-23T15:00:00.000Z')
    expect(lead.appointmentAt).toBeUndefined()
    expect(lead.appointmentClientId).toBeUndefined()
    expect(lead.status).toBe('disqualified')
  })
})

describe('applyOutcome with the new words', () => {
  it('gives a renter a long fuse rather than tomorrow', () => {
    const { lead } = applyOutcome(BASE, 'renter', '2026-09-23T15:00:00.000Z')
    expect(lead.status).toBe('follow_up')
    // Two weeks: the owner has to be found, and knocking the same tenant again
    // on Thursday achieves nothing.
    expect(lead.nextActionAt).toBe('2026-10-07T15:00:00.000Z')
  })

  it('treats "wants inspection" as needing a visit, like interested', () => {
    const { lead, event } = applyOutcome(BASE, 'wants_inspection', '2026-09-23T15:00:00.000Z')
    expect(lead.status).toBe('need_visit')
    expect(lead.knockCount).toBe(1)
    expect(event.outcome).toBe('wants_inspection')
    expect(event.kind).toBe('door_knock')
  })

  it('records "something else" without claiming anything happened', () => {
    const { lead } = applyOutcome(BASE, 'other', '2026-09-23T15:00:00.000Z', { note: 'dog' })
    expect(lead.status).toBe('attempted')
    expect(isConversation('other')).toBe(false)
  })
})
