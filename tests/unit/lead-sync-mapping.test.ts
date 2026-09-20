import { describe, expect, it } from 'vitest'
import { remoteActivityType, remoteLeadStatus } from '@/lib/sync/leads'
import type { ContactKind, LeadStatus } from '@/features/leads/pipeline'

/**
 * The database's `lead_status` enum, as migration 0003 defines it. Written out
 * here on purpose: if someone adds a local status and maps it to a word the
 * enum does not have, the push fails in the field with a 22P02 and the rep
 * sees a lead that will not sync. This catches it at build time instead.
 */
const REMOTE_STATUSES = [
  'untouched',
  'target',
  'attempted',
  'no_answer',
  'spoke',
  'interested',
  'inspection_requested',
  'appointment',
  'inspected',
  'proposal_pending',
  'sold',
  'lost',
  'not_interested',
  'do_not_contact',
  'existing_customer',
]

const LOCAL_STATUSES: LeadStatus[] = [
  'new',
  'attempted',
  'follow_up',
  'need_visit',
  'appointment',
  'inspected',
  'not_interested',
  'do_not_knock',
]

const LOCAL_KINDS: ContactKind[] = [
  'door_knock',
  'call_placed',
  'text_initiated',
  'note',
  'appointment_set',
  'inspection_started',
]

describe('local status to the database enum', () => {
  it.each(LOCAL_STATUSES)('%s maps to a value the enum actually has', (status) => {
    expect(REMOTE_STATUSES).toContain(remoteLeadStatus(status))
  })

  it('sends do-not-knock as the strongest word available', () => {
    expect(remoteLeadStatus('do_not_knock')).toBe('do_not_contact')
  })

  it('does not call a promoted-but-unknocked door an attempt', () => {
    expect(remoteLeadStatus('new')).toBe('target')
  })

  it('keeps not-interested distinct from do-not-contact', () => {
    expect(remoteLeadStatus('not_interested')).not.toBe(remoteLeadStatus('do_not_knock'))
  })
})

describe('local contact kind to the activity vocabulary', () => {
  it.each(LOCAL_KINDS)('%s maps to something non-empty', (kind) => {
    expect(remoteActivityType(kind)).toMatch(/^[a-z_]+$/)
  })

  it('records a placed call as a call, not as a completed one', () => {
    expect(remoteActivityType('call_placed')).toBe('call')
  })

  it('records an initiated text as a text, not as a delivered one', () => {
    expect(remoteActivityType('text_initiated')).toBe('text')
  })
})
