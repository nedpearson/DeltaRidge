import { describe, expect, it } from 'vitest'
import {
  bestPhone,
  digitsOf,
  isDialable,
  isSuppressed,
  liftDoNotCall,
  mergeProviderPhones,
  rankPhones,
  sameNumber,
  setPrimary,
  setStatus,
  type MergeContext,
  type PhoneRecord,
  type PhoneStatus,
} from '@/features/contacts/phones'

const base: PhoneRecord = {
  id: 'p1',
  number: '(225) 555-0142',
  label: 'primary',
  status: 'unconfirmed',
  kind: 'unknown',
  source: 'third_party_lookup',
  providerConfidence: null,
  enteredBy: null,
  enteredAt: '2026-09-01T00:00:00.000Z',
  statusSetBy: null,
  statusSetAt: null,
}
const other = (over: Partial<PhoneRecord>): PhoneRecord => ({ ...base, ...over })

let counter = 0
const ctx = (): MergeContext => ({
  source: 'beenverified',
  at: '2026-09-23T00:00:00.000Z',
  by: 'rep-1',
  // A global counter, as the signature now forces. The old signature took the
  // index within the batch and invited colliding ids across refreshes.
  newId: () => `new-${(counter += 1)}`,
})
const OK = { allowed: true } as const

function mergedPhones(...args: Parameters<typeof mergeProviderPhones>) {
  const result = mergeProviderPhones(...args)
  if (!result.ok) throw new Error(`merge refused: ${result.reason}`)
  return result.outcome
}

describe('digitsOf', () => {
  it('drops an extension before taking the digits', () => {
    // Otherwise "555-0142 x12" becomes an 11-digit number and stops matching
    // the same line written without the extension.
    expect(digitsOf('225-555-0142 x12')).toBe('2255550142')
    expect(digitsOf('225-555-0142 ext. 12')).toBe('2255550142')
    expect(digitsOf('225-555-0142 #12')).toBe('2255550142')
  })

  it('does not mistake a digit in the middle for an extension', () => {
    expect(digitsOf('(225) 555-0142')).toBe('2255550142')
  })
})

describe('sameNumber', () => {
  it('ignores formatting and a leading US country code', () => {
    expect(sameNumber('(225) 555-0142', '2255550142')).toBe(true)
    expect(sameNumber('+1 225 555 0142', '2255550142')).toBe(true)
  })

  it('matches across an extension', () => {
    expect(sameNumber('225-555-0142 x12', '2255550142')).toBe(true)
  })

  it('does not collide two different numbers', () => {
    expect(sameNumber('2255550142', '2255550143')).toBe(false)
  })

  it('refuses to match on emptiness', () => {
    expect(sameNumber('', '')).toBe(false)
    expect(sameNumber('abc', '2255550142')).toBe(false)
  })
})

describe('what may be dialled', () => {
  it('allows only unconfirmed and confirmed', () => {
    const dialable: PhoneStatus[] = ['unconfirmed', 'confirmed']
    const dead: PhoneStatus[] = ['wrong_number', 'disconnected', 'do_not_call']
    for (const status of dialable) expect(isDialable(other({ status }))).toBe(true)
    for (const status of dead) expect(isDialable(other({ status }))).toBe(false)
  })

  it('never offers a wrong number as the one to dial', () => {
    // The original deny-list let this through: a rep had already reached a
    // stranger on it, and bestPhone handed it straight back.
    expect(bestPhone([other({ status: 'wrong_number' })])).toBeNull()
  })

  it('puts a confirmed number above an unconfirmed primary', () => {
    const phones = [
      other({ id: 'a', label: 'primary', status: 'unconfirmed' }),
      other({ id: 'b', label: 'secondary', status: 'confirmed', number: '2255550199' }),
    ]
    expect(bestPhone(phones)?.id).toBe('b')
  })

  it('sinks dead ends without hiding them', () => {
    const phones = [
      other({ id: 'dead', status: 'disconnected' }),
      other({ id: 'live', status: 'unconfirmed', number: '2255550199' }),
    ]
    const ranked = rankPhones(phones)
    expect(ranked[ranked.length - 1]?.id).toBe('dead')
    expect(ranked).toHaveLength(2)
  })
})

describe('do-not-call is terminal', () => {
  const dnc = other({ status: 'do_not_call', statusSetBy: 'rep-1', statusSetAt: '2026-09-10T00:00:00Z' })

  it('cannot be lifted by an ordinary status change', () => {
    const result = setStatus([dnc], 'p1', 'unconfirmed', 'rep-2', '2026-09-23T00:00:00Z')
    expect(result.ok).toBe(false)
  })

  it('does not lose who suppressed it when somebody tries', () => {
    const result = setStatus([dnc], 'p1', 'confirmed', 'rep-2', '2026-09-23T00:00:00Z')
    expect(result.ok).toBe(false)
    // The record is untouched, so the audit of who suppressed it survives.
    expect(dnc.statusSetBy).toBe('rep-1')
  })

  it('is lifted only deliberately, and only with a reason', () => {
    expect(liftDoNotCall([dnc], dnc.number, 'admin', '2026-09-23T00:00:00Z', '   ').ok).toBe(false)
    const lifted = liftDoNotCall([dnc], dnc.number, 'admin', '2026-09-23T00:00:00Z', 'homeowner called us back')
    expect(lifted.ok).toBe(true)
    if (!lifted.ok) return
    expect(lifted.phones[0]?.status).toBe('unconfirmed')
  })

  it('is a property of the line, not of one row', () => {
    expect(isSuppressed([dnc], '+1 (225) 555-0142')).toBe(true)
    expect(isSuppressed([dnc], '225-555-0142 x12')).toBe(true)
    expect(isSuppressed([dnc], '2255559999')).toBe(false)
  })

  it('refuses an ordinary status change on a number that is gone', () => {
    expect(setStatus([base], 'nope', 'confirmed', 'rep-1', '2026-09-23T00:00:00Z').ok).toBe(false)
  })
})

describe('setStatus', () => {
  it('records who said so and when', () => {
    const result = setStatus([base], 'p1', 'confirmed', 'rep-9', '2026-09-23T12:00:00.000Z')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.phones[0]?.status).toBe('confirmed')
    expect(result.phones[0]?.statusSetBy).toBe('rep-9')
    expect(result.phones[0]?.statusSetAt).toBe('2026-09-23T12:00:00.000Z')
  })
})

describe('setPrimary', () => {
  it('leaves exactly one primary and demotes the old one to secondary', () => {
    const phones = [other({ id: 'a', label: 'primary' }), other({ id: 'b', label: 'other' })]
    const next = setPrimary(phones, 'b')
    expect(next.filter((p) => p.label === 'primary')).toHaveLength(1)
    expect(next.find((p) => p.id === 'a')?.label).toBe('secondary')
  })

  it('changes nothing when the target is gone, rather than leaving no primary', () => {
    // Reachable on a stale list: the demote branch used to run regardless.
    const phones = [other({ id: 'a', label: 'primary' }), other({ id: 'b', label: 'other' })]
    const next = setPrimary(phones, 'vanished')
    expect(next.filter((p) => p.label === 'primary')).toHaveLength(1)
    expect(next).toEqual(phones)
  })
})

describe('mergeProviderPhones', () => {
  it('refuses entirely when the provider gate says no', () => {
    // The gate is in the signature so a caller cannot forget it.
    const result = mergeProviderPhones([], [{ number: '2255550199', kind: 'mobile', providerConfidence: 'high' }], ctx(), {
      allowed: false,
      reason: 'consumer subscription',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('consumer subscription')
  })

  it('adds numbers it has not seen', () => {
    const out = mergedPhones([base], [{ number: '2255550199', kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    expect(out.added).toBe(1)
    expect(out.phones).toHaveLength(2)
  })

  it('carries the provider kind and confidence through verbatim', () => {
    // The previous version of this test passed 'unknown'/null and asserted
    // 'unknown'/null, so an implementation that hardcoded those would have
    // passed it. This asserts the values actually travel.
    const out = mergedPhones([], [{ number: '2255550199', kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    expect(out.phones[0]?.kind).toBe('mobile')
    expect(out.phones[0]?.providerConfidence).toBe('high')
  })

  it('invents nothing when the provider says nothing', () => {
    const out = mergedPhones([], [{ number: '2255550199', kind: 'unknown', providerConfidence: null }], ctx(), OK)
    expect(out.phones[0]?.kind).toBe('unknown')
    expect(out.phones[0]?.providerConfidence).toBeNull()
    // No human is stamped on a record a provider supplied.
    expect(out.phones[0]?.enteredBy).toBeNull()
  })

  it('does not duplicate a number it already holds in another format', () => {
    const out = mergedPhones([base], [{ number: '+1 (225) 555-0142', kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    expect(out.added).toBe(0)
  })

  it('dedupes two spellings inside one provider response', () => {
    // An append API returning E.164 and national format for one line is normal,
    // and both copies used to survive with contradictory kinds.
    const out = mergedPhones([], [
      { number: '2255550142', kind: 'mobile', providerConfidence: 'high' },
      { number: '+1 (225) 555-0142', kind: 'landline', providerConfidence: 'low' },
    ], ctx(), OK)
    expect(out.added).toBe(1)
    expect(out.duplicatesInBatch).toBe(1)
  })

  it('will not resurrect a suppressed line under a different spelling', () => {
    const dnc = other({ number: '(225) 555-0142 ext. 12', status: 'do_not_call', statusSetBy: 'rep-1' })
    const out = mergedPhones([dnc], [{ number: '2255550142', kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    expect(out.added).toBe(0)
    expect(out.suppressed).toBe(1)
    expect(bestPhone(out.phones)).toBeNull()
  })

  it('never resets a status a person set', () => {
    const marked = other({ status: 'wrong_number', statusSetBy: 'rep-1', statusSetAt: '2026-09-10T00:00:00Z' })
    const out = mergedPhones([marked], [{ number: marked.number, kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    const after = out.phones.find((p) => p.id === marked.id)
    expect(after?.status).toBe('wrong_number')
    expect(after?.statusSetBy).toBe('rep-1')
  })

  it('counts preserved from the output, so the count can actually fail', () => {
    // Computed from the input, this assertion was unfalsifiable: the function
    // could have reset every status and still reported the same number.
    const marked = other({ status: 'wrong_number', statusSetBy: 'rep-1' })
    const out = mergedPhones([marked], [{ number: marked.number, kind: 'mobile', providerConfidence: null }], ctx(), OK)
    expect(out.preserved).toBe(1)

    const untouched = mergedPhones([other({ statusSetBy: null })], [], ctx(), OK)
    expect(untouched.preserved).toBe(0)
  })

  it('does not upgrade an existing record from what the provider now claims', () => {
    const held = other({ kind: 'unknown', providerConfidence: null })
    const out = mergedPhones([held], [{ number: held.number, kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    const after = out.phones.find((p) => p.id === held.id)
    expect(after?.kind).toBe('unknown')
    expect(after?.providerConfidence).toBeNull()
  })

  it('reports numbers the provider dropped without deleting them', () => {
    const held = other({ status: 'confirmed', statusSetBy: 'rep-1' })
    const out = mergedPhones([held], [{ number: '2255559999', kind: 'unknown', providerConfidence: null }], ctx(), OK)
    expect(out.noLongerReturned).toBe(1)
    expect(out.phones.some((p) => p.id === held.id)).toBe(true)
  })

  it('never lands a new number as primary, even on an empty lead', () => {
    const out = mergedPhones([], [{ number: '2255550199', kind: 'mobile', providerConfidence: 'high' }], ctx(), OK)
    expect(out.phones[0]?.label).toBe('other')
    expect(out.phones[0]?.status).toBe('unconfirmed')
  })

  it('mints a distinct id on every refresh', () => {
    // Colliding ids made setStatus mutate every record sharing one.
    const first = mergedPhones([], [{ number: '2255550142', kind: 'unknown', providerConfidence: null }], ctx(), OK)
    const second = mergedPhones(first.phones, [{ number: '2255559999', kind: 'unknown', providerConfidence: null }], ctx(), OK)
    const ids = second.phones.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
