import { describe, expect, it } from 'vitest'
import {
  describeEvent,
  idempotencyKey,
  linkPatchFor,
  normalizeEvent,
  parseEventType,
  parseInstant,
  parseMoneyCents,
  type NormalizedEvent,
} from '../../supabase/functions/roofr-events/events'

/**
 * These tests exist because every input here comes from a Zap somebody else
 * configured. The failures they guard against are not crashes — they are
 * plausible-looking numbers and timestamps that are quietly wrong.
 */

const base: NormalizedEvent = {
  providerEventId: 'evt_1',
  eventType: 'proposal_sent',
  occurredAt: '2026-09-20T15:00:00.000Z',
  roofrJobId: 'job_9',
  roofrCustomerId: 'cus_9',
  externalJobId: null,
  workflowStage: null,
  proposalTotalCents: null,
  addressLine1: null,
  postalCode: null,
}

describe('parseEventType', () => {
  it('accepts the three spellings the same event arrives under', () => {
    expect(parseEventType('Proposal Signed')).toBe('proposal_signed')
    expect(parseEventType('proposal_signed')).toBe('proposal_signed')
    expect(parseEventType('proposal.signed')).toBe('proposal_signed')
  })

  it('accepts the Zapier trigger label verbatim', () => {
    expect(parseEventType('Job Workflow Stage Changed')).toBe('workflow_stage_changed')
    expect(parseEventType('Roofr Lead Created')).toBe('lead_created')
  })

  it('refuses an event Roofr does not send rather than guessing the nearest one', () => {
    expect(parseEventType('proposal_deleted')).toBeNull()
    expect(parseEventType('')).toBeNull()
    expect(parseEventType(42)).toBeNull()
  })
})

describe('parseMoneyCents', () => {
  it('reads the formats a proposal total actually arrives in', () => {
    expect(parseMoneyCents('$12,345.67')).toBe(1234567)
    expect(parseMoneyCents('12345.67')).toBe(1234567)
    expect(parseMoneyCents(12345.67)).toBe(1234567)
    expect(parseMoneyCents('12345')).toBe(1234500)
    expect(parseMoneyCents('12,345')).toBe(1234500)
  })

  it('does not lose a cent to binary floating point', () => {
    // 1.10 * 100 is 110.00000000000001, and `Math.round` hides it here but not
    // at every magnitude. The string path avoids the question entirely.
    expect(parseMoneyCents(1.1)).toBe(110)
    expect(parseMoneyCents(8.29)).toBe(829)
    expect(parseMoneyCents(19_999.99)).toBe(1999999)
  })

  it('truncates rather than rounds sub-cent noise into a different number', () => {
    expect(parseMoneyCents('10.999')).toBe(1099)
  })

  it('refuses what is not a number, instead of storing zero', () => {
    expect(parseMoneyCents('pending')).toBeNull()
    expect(parseMoneyCents('')).toBeNull()
    expect(parseMoneyCents(null)).toBeNull()
    expect(parseMoneyCents(undefined)).toBeNull()
    expect(parseMoneyCents(Number.NaN)).toBeNull()
    expect(parseMoneyCents({})).toBeNull()
  })

  it('refuses a negative total, which is a mapping error and not a discount', () => {
    expect(parseMoneyCents('-500.00')).toBeNull()
    expect(parseMoneyCents('($500.00)')).toBeNull()
  })
})

describe('parseInstant', () => {
  it('accepts ISO and epoch, in seconds or milliseconds', () => {
    expect(parseInstant('2026-09-20T15:00:00Z')).toBe('2026-09-20T15:00:00.000Z')
    expect(parseInstant(1789045200)).toBe(new Date(1789045200000).toISOString())
    expect(parseInstant(1789045200000)).toBe(new Date(1789045200000).toISOString())
  })

  it('refuses a timestamp that is obviously a units mistake', () => {
    // A zero that travelled through a mapping becomes 1970.
    expect(parseInstant('1970-01-01T00:00:00Z')).toBeNull()
    // Milliseconds read as seconds land centuries out.
    expect(parseInstant('2380-01-01T00:00:00Z')).toBeNull()
  })

  it('returns null rather than now() for something unreadable', () => {
    expect(parseInstant('yesterday')).toBeNull()
    expect(parseInstant('')).toBeNull()
    expect(parseInstant(null)).toBeNull()
  })
})

describe('idempotencyKey', () => {
  it('prefers an explicit id', () => {
    expect(idempotencyKey({ event_id: 'evt_77', roofr_job_id: 'j1' }, 'proposal_sent')).toBe('evt_77')
  })

  it('derives a stable key so a Zapier retry is recognisable as the same event', () => {
    const body = { roofr_job_id: 'j1', occurred_at: '2026-09-20T15:00:00Z' }
    const first = idempotencyKey(body, 'proposal_signed')
    const second = idempotencyKey({ ...body }, 'proposal_signed')
    expect(first).toBe(second)
    expect(first).not.toBeNull()
  })

  it('gives two different events on the same job two different keys', () => {
    const job = { roofr_job_id: 'j1', occurred_at: '2026-09-20T15:00:00Z' }
    expect(idempotencyKey(job, 'proposal_sent')).not.toBe(idempotencyKey(job, 'proposal_signed'))
    expect(idempotencyKey(job, 'proposal_sent')).not.toBe(
      idempotencyKey({ ...job, occurred_at: '2026-09-20T16:00:00Z' }, 'proposal_sent'),
    )
  })

  it('refuses when there is nothing to deduplicate on', () => {
    // Accepting this would mean every retry creates another timeline entry.
    expect(idempotencyKey({ roofr_job_id: 'j1' }, 'proposal_sent')).toBeNull()
    expect(idempotencyKey({ occurred_at: '2026-09-20T15:00:00Z' }, 'proposal_sent')).toBeNull()
  })
})

describe('normalizeEvent', () => {
  it('reads a realistic Zapier payload', () => {
    const result = normalizeEvent({
      event_id: 'evt_abc',
      event_type: 'Proposal Signed',
      occurred_at: '2026-09-20T15:04:05Z',
      roofr_job_id: '88213',
      customer_id: '4471',
      proposal_total: '$18,400.00',
      address: '742 Evergreen Ter',
      zip: '70601',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event.eventType).toBe('proposal_signed')
    expect(result.event.roofrJobId).toBe('88213')
    expect(result.event.roofrCustomerId).toBe('4471')
    expect(result.event.proposalTotalCents).toBe(1840000)
    expect(result.event.addressLine1).toBe('742 Evergreen Ter')
    expect(result.event.postalCode).toBe('70601')
  })

  it('refuses a body that is not an object', () => {
    expect(normalizeEvent('{}').ok).toBe(false)
    expect(normalizeEvent([]).ok).toBe(false)
    expect(normalizeEvent(null).ok).toBe(false)
  })

  it('names why it refused, so the sync log is diagnosable', () => {
    const result = normalizeEvent({ event_id: 'e1', event_type: 'invoice_paid' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('event_type')
  })
})

describe('linkPatchFor', () => {
  it('stamps only the column its own event owns', () => {
    const patch = linkPatchFor({ ...base, eventType: 'proposal_viewed' })
    expect(patch['proposal_viewed_at']).toBe('2026-09-20T15:00:00.000Z')
    expect(patch['proposal_signed_at']).toBeUndefined()
    expect(patch['proposal_sent_at']).toBeUndefined()
  })

  it('never blanks a known total when an adjustment arrives unreadable', () => {
    // The event says the total changed but the amount did not parse. Writing
    // null here would erase a figure somebody is quoting from.
    const patch = linkPatchFor({
      ...base,
      eventType: 'proposal_total_adjusted',
      proposalTotalCents: null,
    })
    expect('proposal_total_cents' in patch).toBe(false)
  })

  it('never blanks a workflow stage when the stage name is missing', () => {
    const patch = linkPatchFor({ ...base, eventType: 'workflow_stage_changed', workflowStage: null })
    expect('workflow_stage' in patch).toBe(false)
    expect(patch['last_event_at']).toBeTruthy()
  })

  it('touches nothing that belongs to Delta Ridge', () => {
    const patch = linkPatchFor({ ...base, eventType: 'proposal_signed' })
    for (const key of Object.keys(patch)) {
      expect(key).not.toMatch(/^(status|opportunity_score|assigned_to|originating_rep_id)$/)
    }
  })
})

describe('describeEvent', () => {
  it('reads as a sentence with the money in it', () => {
    expect(describeEvent({ ...base, eventType: 'proposal_signed', proposalTotalCents: 1840000 })).toBe(
      'Proposal signed in Roofr ($18,400.00)',
    )
  })

  it('says something true when the stage name did not arrive', () => {
    expect(describeEvent({ ...base, eventType: 'workflow_stage_changed' })).toBe(
      'Roofr job moved to a new stage',
    )
  })
})
