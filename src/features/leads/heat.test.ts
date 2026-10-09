import appCopy from './heat.ts?raw'
import edgeCopy from '../../../supabase/functions/_shared/heat.ts?raw'
import { describe, expect, it } from 'vitest'
import { mailerRefCode, oneOf, DAMAGE_VALUES, scoreHeat, type HeatAnswers, type HeatStorm } from './heat'

const hotAnswers: HeatAnswers = {
  owner: true,
  damage: 'leak',
  roofAge: 'over15',
  insurance: 'yes',
  claim: 'want_documentation',
  slotChosen: true,
  decisionMakersPresent: true,
}
const bigRecentHail: HeatStorm = { maxHailInches: 1.75, daysSince: 40, unavailable: false }
const noHail: HeatStorm = { maxHailInches: null, daysSince: null, unavailable: false }

describe('scoreHeat', () => {
  it('scores a leak + old roof + recent big hail + booked slot as hot', () => {
    const r = scoreHeat(hotAnswers, bigRecentHail)
    expect(r.tier).toBe('hot')
    expect(r.score).toBe(98)
    expect(r.reasons[0]).toMatch(/Radar hail 1.75"/)
  })

  it('never lets a renter through, whatever else they said', () => {
    const r = scoreHeat({ ...hotAnswers, owner: false }, bigRecentHail)
    expect(r.tier).toBe('not_eligible')
    expect(r.score).toBe(0)
  })

  it('keeps a strong homeowner warm even with no hail on record', () => {
    const r = scoreHeat(hotAnswers, noHail)
    expect(r.score).toBe(68)
    expect(r.tier).toBe('warm')
  })

  it('says the storm lookup failed rather than implying no hail', () => {
    const r = scoreHeat(hotAnswers, { maxHailInches: null, daysSince: null, unavailable: true })
    expect(r.reasons.some((x) => x.includes('unavailable'))).toBe(true)
  })

  it('treats old hail as weaker than recent hail of the same size', () => {
    const recent = scoreHeat(hotAnswers, { maxHailInches: 1.2, daysSince: 100, unavailable: false })
    const old = scoreHeat(hotAnswers, { maxHailInches: 1.2, daysSince: 500, unavailable: false })
    expect(recent.score - old.score).toBe(10)
  })

  it('scores a no-damage, new-roof, uninsured request as cool', () => {
    const r = scoreHeat(
      { owner: true, damage: 'none', roofAge: 'under5', insurance: 'no', claim: 'not_yet', slotChosen: false, decisionMakersPresent: false },
      noHail,
    )
    expect(r.tier).toBe('cool')
    expect(r.score).toBe(4)
  })

  it('caps at 100', () => {
    expect(scoreHeat({ ...hotAnswers, claim: 'filed' }, bigRecentHail).score).toBe(100)
  })
})

describe('input guards', () => {
  it('accepts only known values', () => {
    expect(oneOf(DAMAGE_VALUES, 'leak')).toBe('leak')
    expect(oneOf(DAMAGE_VALUES, 'LEAK')).toBeNull()
    expect(oneOf(DAMAGE_VALUES, 3)).toBeNull()
  })

  it('builds a stable 10-char mailer code from a property id', () => {
    expect(mailerRefCode('d17a0000-0000-4000-8000-000000000001')).toBe('D17A000000')
  })
})

describe('edge-function copy', () => {
  it('is byte-identical to the app copy, so both score the same way', () => {
    expect(edgeCopy.length).toBeGreaterThan(1000)
    expect(edgeCopy).toBe(appCopy)
  })
})
