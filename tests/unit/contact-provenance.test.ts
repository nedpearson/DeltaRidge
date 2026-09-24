import { describe, expect, it } from 'vitest'
import {
  CONTACT_SOURCE_LABEL,
  applyOutcome,
  contactSourceOf,
  isFromHomeowner,
  mayContact,
  optOut,
  setConsent,
  setContact,
  type ManagedLead,
} from '@/features/leads/pipeline'

/**
 * A number the homeowner said out loud and a number off a people-search service
 * were the same field on the same row. That distinction is the entire question
 * if a call is ever challenged: "we had their number" is not an answer.
 */

const BASE: ManagedLead = {
  id: 'lead-1',
  addressKey: '18818-bella-vista',
  address: '18818 BELLA VISTA CT',
  latitude: 30.4,
  longitude: -91.1,
  score: 62,
  reasons: ['hail'],
  status: 'follow_up',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  knockCount: 1,
}

const AT = '2026-09-24T15:00:00.000Z'

describe('where a number came from', () => {
  it('has a label for every source, so nothing renders as a raw key', () => {
    for (const [key, label] of Object.entries(CONTACT_SOURCE_LABEL)) {
      expect(label.length, key).toBeGreaterThan(3)
    }
  })

  it('counts only the homeowner handing it over as coming from them', () => {
    expect(isFromHomeowner('homeowner_at_door')).toBe(true)
    expect(isFromHomeowner('homeowner_by_phone')).toBe(true)
    expect(isFromHomeowner('homeowner_in_writing')).toBe(true)
    // Accurate or not, these are somebody else telling us about them.
    expect(isFromHomeowner('public_record')).toBe(false)
    expect(isFromHomeowner('third_party_lookup')).toBe(false)
    expect(isFromHomeowner('unknown')).toBe(false)
  })

  it('reports nothing for a lead with no number at all', () => {
    expect(contactSourceOf(BASE)).toBeNull()
  })

  it('reads a legacy number as given at the door, because nothing else could set one', () => {
    // Real field data predates this field. Treating it as unknown would block
    // numbers homeowners actually gave, which is the wrong kind of careful.
    const legacy: ManagedLead = { ...BASE, contactPhone: '225-555-0101' }
    expect(contactSourceOf(legacy)).toBe('homeowner_at_door')
  })

  it('records the door sheet’s own provenance without being told', () => {
    const { lead } = applyOutcome(BASE, 'spoke', AT, { contactPhone: '225-555-0102' })
    expect(lead.contactSource).toBe('homeowner_at_door')
  })
})

describe('what the app will let you dial', () => {
  function withPhone(source: Parameters<typeof setContact>[1]['source']): ManagedLead {
    const lead = setContact(BASE, { phone: '225-555-0103', source }, AT)
    return setConsent(lead, 'call', true, AT)
  }

  it('allows a call to a number they gave you, once they have said yes', () => {
    expect(mayContact(withPhone('homeowner_at_door'), 'call').allowed).toBe(true)
  })

  it('refuses a looked-up number even with consent recorded against it', () => {
    // Consent recorded against a number the homeowner never handed over is not
    // consent from whoever answers it.
    const result = mayContact(withPhone('third_party_lookup'), 'call')
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toMatch(/records lookup/i)
    expect(result.allowed === false && result.reason).toMatch(/Confirm it at the door/)
  })

  it('refuses a public-record number the same way', () => {
    const result = mayContact(withPhone('public_record'), 'call')
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toMatch(/public record/i)
  })

  it('refuses a number whose source nobody wrote down', () => {
    const result = mayContact(withPhone('unknown'), 'sms')
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toMatch(/where this number came from/)
  })

  it('does not block email on phone provenance', () => {
    // The restriction is about a phone number belonging to the person who
    // answers it. Email consent is a separate question with its own gate.
    const lead = setConsent(
      setContact(BASE, { phone: '225-555-0104', source: 'third_party_lookup' }, AT),
      'email',
      true,
      AT,
    )
    expect(mayContact(lead, 'email').allowed).toBe(true)
  })

  it('still puts the opt-out ahead of everything', () => {
    const lead = optOut(withPhone('homeowner_at_door'), AT)
    const result = mayContact(lead, 'call')
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toMatch(/asked not to be contacted/)
  })
})

describe('changing the number', () => {
  it('drops phone consent when the number changes', () => {
    // Permission to call was permission to call THAT number. Carrying it across
    // is how a consent record stops meaning anything.
    const first = setConsent(
      setContact(BASE, { phone: '225-555-0105', source: 'homeowner_at_door' }, AT),
      'call',
      true,
      AT,
    )
    expect(mayContact(first, 'call').allowed).toBe(true)

    const changed = setContact(first, { phone: '225-555-0199', source: 'homeowner_at_door' }, AT)
    const result = mayContact(changed, 'call')
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toMatch(/No recorded permission/)
  })

  it('keeps email consent, which was never about the phone number', () => {
    const lead = setConsent(
      setContact(BASE, { phone: '225-555-0106', source: 'homeowner_at_door' }, AT),
      'email',
      true,
      AT,
    )
    const changed = setContact(lead, { phone: '225-555-0200', source: 'homeowner_at_door' }, AT)
    expect(changed.consent?.email).toBeDefined()
  })

  it('leaves consent alone when the same number is re-recorded', () => {
    const lead = setConsent(
      setContact(BASE, { phone: '225-555-0107', source: 'homeowner_at_door' }, AT),
      'call',
      true,
      AT,
    )
    const same = setContact(lead, { phone: '225-555-0107', source: 'homeowner_at_door' }, AT)
    expect(mayContact(same, 'call').allowed).toBe(true)
  })

  it('never mutates the lead it was given', () => {
    const before = { ...BASE }
    setContact(BASE, { phone: '225-555-0108', source: 'third_party_lookup' }, AT)
    expect(BASE).toEqual(before)
  })
})
