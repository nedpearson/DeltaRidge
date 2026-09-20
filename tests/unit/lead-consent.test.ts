import { describe, expect, it } from 'vitest'
import {
  consentTally,
  mayContact,
  optOut,
  setConsent,
  type ManagedLead,
} from '@/features/leads/pipeline'

const AT = '2026-09-20T15:00:00.000Z'

function lead(overrides: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: 'a|70809',
    address: '18818 BELLA VISTA CT BATON ROUGE LA 70809',
    latitude: 30.36,
    longitude: -91.05,
    score: 44,
    reasons: [],
    status: 'follow_up',
    createdAt: AT,
    updatedAt: AT,
    knockCount: 1,
    contactPhone: '225-555-0142',
    ...overrides,
  }
}

describe('permission to contact', () => {
  it('refuses by default, because a phone number is not permission', () => {
    const block = mayContact(lead(), 'sms')
    expect(block.allowed).toBe(false)
    if (block.allowed) throw new Error('unreachable')
    expect(block.reason).toContain('No recorded permission')
  })

  it('allows a channel once they said yes to that channel', () => {
    const withConsent = setConsent(lead(), 'sms', true, AT)
    expect(mayContact(withConsent, 'sms').allowed).toBe(true)
  })

  it('does not let permission on one channel leak to another', () => {
    const withConsent = setConsent(lead(), 'call', true, AT)
    expect(mayContact(withConsent, 'call').allowed).toBe(true)
    expect(mayContact(withConsent, 'sms').allowed).toBe(false)
  })

  it('refuses a call or text when there is no number to use', () => {
    const noPhone = lead()
    delete noPhone.contactPhone
    const block = mayContact(setConsent(noPhone, 'call', true, AT), 'call')
    expect(block.allowed).toBe(false)
    if (block.allowed) throw new Error('unreachable')
    expect(block.reason).toContain('No phone number')
  })

  it('refuses every channel for a door marked do not knock', () => {
    const dnk = setConsent(lead({ status: 'do_not_knock' }), 'sms', true, AT)
    expect(mayContact(dnk, 'sms').allowed).toBe(false)
    expect(mayContact(dnk, 'call').allowed).toBe(false)
    expect(mayContact(dnk, 'email').allowed).toBe(false)
  })

  it('never mutates the lead it was given', () => {
    const original = lead()
    setConsent(original, 'sms', true, AT)
    expect(original.consent).toBeUndefined()
  })

  it('removes the key entirely when permission is withdrawn', () => {
    const granted = setConsent(lead(), 'sms', true, AT)
    const withdrawn = setConsent(granted, 'sms', false, AT)
    expect('consent' in withdrawn).toBe(false)
  })
})

describe('opting out', () => {
  it('beats every consent already on the record', () => {
    const granted = setConsent(setConsent(lead(), 'sms', true, AT), 'call', true, AT)
    const stopped = optOut(granted, AT)
    expect(mayContact(stopped, 'sms').allowed).toBe(false)
    expect(mayContact(stopped, 'call').allowed).toBe(false)
  })

  it('clears the consents rather than leaving them to be re-enabled', () => {
    const stopped = optOut(setConsent(lead(), 'sms', true, AT), AT)
    expect('consent' in stopped).toBe(false)
    expect(stopped.optedOutAt).toBe(AT)
  })

  it('says why, in words a rep can repeat to a homeowner', () => {
    const block = mayContact(optOut(lead(), AT), 'sms')
    if (block.allowed) throw new Error('unreachable')
    expect(block.reason).toBe('They asked not to be contacted.')
  })
})

describe('what the pipeline actually has permission for', () => {
  it('counts each channel separately and never rounds up', () => {
    const tally = consentTally([
      setConsent(lead({ id: 'a', addressKey: 'a' }), 'sms', true, AT),
      setConsent(lead({ id: 'b', addressKey: 'b' }), 'call', true, AT),
      lead({ id: 'c', addressKey: 'c' }),
      optOut(lead({ id: 'd', addressKey: 'd' }), AT),
    ])
    expect(tally).toEqual({
      total: 4,
      call: 1,
      sms: 1,
      email: 0,
      optedOut: 1,
      reachableSomehow: 2,
    })
  })

  it('reports an empty pipeline as nothing, not as everything', () => {
    expect(consentTally([])).toEqual({
      total: 0,
      call: 0,
      sms: 0,
      email: 0,
      optedOut: 0,
      reachableSomehow: 0,
    })
  })
})
