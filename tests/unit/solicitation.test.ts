import { describe, expect, it } from 'vitest'
import { mayCallAt, prohibitedConduct } from '@/features/compliance/engine'
import {
  ALL_SOLICITATION_RULES,
  FEDERAL_SOLICITATION_RULES,
  LOUISIANA_SOLICITATION_RULES,
} from '@/features/compliance/solicitation'

/**
 * These rules exist because the compliance engine had eleven rows about
 * licences, permits, codes and contracts and none at all about picking up the
 * phone — which is the one thing in this business with a per-incident price tag
 * and a private right of action behind it.
 *
 * The tests are mostly about the Louisiana rule being TIGHTER than the federal
 * one, because that is the part everybody gets wrong.
 */

const EBR = { state: 'LA', parish: 'East Baton Rouge', municipality: null }

/** A local wall-clock time, which is what the rules are written in. */
function at(iso: string): Date {
  return new Date(iso)
}

describe('the Louisiana calling window', () => {
  it('allows a weekday afternoon', () => {
    // Wednesday 2pm.
    const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-23T14:00:00'))
    expect(verdict.allowed).toBe(true)
    expect(verdict.reasons).toEqual([])
  })

  it('refuses a Sunday outright, at any hour', () => {
    // The federal rule has no weekday blackout at all, so this is entirely the
    // state order — and Sunday afternoon is prime door-knocking time, which is
    // exactly why a rep would reach for the phone then.
    for (const hour of ['09:00', '13:00', '17:00']) {
      const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at(`2026-09-27T${hour}:00`))
      expect(verdict.allowed, hour).toBe(false)
      expect(verdict.reasons.join(' ')).toMatch(/Sunday/)
    }
  })

  it('stops at 8pm in Louisiana, not the federal 9pm', () => {
    const eight = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-23T20:00:00'))
    expect(eight.allowed).toBe(false)
    expect(eight.reasons.join(' ')).toMatch(/8pm/)

    // Federal alone would have allowed it — federal rules apply in Louisiana
    // too, and the tightest of the applicable rules is the one that binds.
    const federalOnly = mayCallAt(FEDERAL_SOLICITATION_RULES, EBR, at('2026-09-23T20:00:00'))
    expect(federalOnly.allowed).toBe(true)
    expect(federalOnly.ruleIds).toContain('fed-dnc-registry')
  })

  it('refuses before 8am', () => {
    const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-23T07:30:00'))
    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/Too early/)
  })

  it('cites the rule that blocked it rather than just saying no', () => {
    const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-27T13:00:00'))
    expect(verdict.reasons.join(' ')).toMatch(/LPSC/)
    expect(verdict.ruleIds).toContain('la-dnc-calling-window')
  })

  it('asks about legal holidays instead of guessing a calendar', () => {
    // A wrong holiday calendar is worse than none: it would clear a call on a
    // day the state prohibits it.
    const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-23T14:00:00'))
    expect(verdict.requires).toContain('not_a_legal_holiday')
  })

  it('never clears a number, only ever constrains the moment', () => {
    const verdict = mayCallAt(ALL_SOLICITATION_RULES, EBR, at('2026-09-23T14:00:00'))
    // Allowed means "this hour is permitted", not "this number is safe".
    expect(verdict.requires).toContain('number_not_on_louisiana_do_not_call_list')
    expect(verdict.requires).toContain('number_not_on_national_do_not_call_registry')
  })
})

describe('what the software must never do', () => {
  it('names autodialling a wireless number without written consent', () => {
    const banned = prohibitedConduct(ALL_SOLICITATION_RULES, EBR, '2026-09-24')
    expect(banned).toContain('autodial_wireless_without_prior_express_written_consent')
    expect(banned).toContain('prerecorded_marketing_call_without_prior_express_written_consent')
  })

  it('names calling a Louisiana do-not-call number and soliciting unregistered', () => {
    const banned = prohibitedConduct(ALL_SOLICITATION_RULES, EBR, '2026-09-24')
    expect(banned).toContain('call_number_on_louisiana_do_not_call_list')
    expect(banned).toContain('solicit_by_phone_without_lpsc_registration')
  })
})

describe('the engine when it knows nothing', () => {
  it('refuses rather than clearing a call in a place it has no rules for', () => {
    // "We have not loaded any telephone rules for Mississippi" and "this call
    // is fine" are opposite answers. Returning the second for the first is how
    // an engine gives its most confident wrong answer exactly where it knows
    // least.
    const verdict = mayCallAt(
      LOUISIANA_SOLICITATION_RULES,
      { state: 'MS', parish: 'Harrison', municipality: null },
      at('2026-09-23T14:00:00'),
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/nothing has cleared this call/)
    expect(verdict.ruleIds).toEqual([])
  })
})

describe('every rule here carries its source', () => {
  it('has a citation, a url and a date somebody read it', () => {
    for (const rule of ALL_SOLICITATION_RULES) {
      expect(rule.source, rule.id).not.toBeNull()
      expect(rule.source?.citation.length, rule.id).toBeGreaterThan(5)
      expect(rule.source?.url, rule.id).toMatch(/^https:\/\//)
      expect(rule.source?.verifiedAt, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('quotes the source in its notes rather than paraphrasing it away', () => {
    const hours = LOUISIANA_SOLICITATION_RULES.find((r) => r.id === 'la-dnc-calling-window')
    expect(hours?.notes).toMatch(/8:00 P\.M\. and 8:00 A\.M\./)
  })

  it('records that Louisiana’s business-relationship window is shorter than the federal one', () => {
    // Six months, against eighteen. A federal exemption does not rescue a
    // Louisiana call, and that is the kind of thing that gets assumed.
    const hours = LOUISIANA_SOLICITATION_RULES.find((r) => r.id === 'la-dnc-calling-window')
    expect(hours?.notes).toMatch(/six \(6\) months/)
    const federal = FEDERAL_SOLICITATION_RULES.find((r) => r.id === 'fed-dnc-registry')
    expect(federal?.notes).toMatch(/eighteen months/)
    expect(federal?.notes).toMatch(/THREE months/)
  })
})
