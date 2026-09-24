import { describe, expect, it } from 'vitest'
import {
  checkLanguage,
  permittedCopyStrength,
  type EvidencePosture,
} from '@/features/claims/language'

/**
 * The sentences below are not hypothetical. They are the things roofing reps
 * actually say on driveways, and each one is a representation the company
 * cannot honour about money that is not its to commit.
 */

function kindsIn(text: string): string[] {
  const result = checkLanguage(text)
  return result.ok ? [] : result.violations.map((v) => v.kind)
}

describe('promises about what a carrier will do', () => {
  const banned = [
    'Insurance will pay for the whole roof.',
    'Your carrier is going to cover this.',
    "They're going to take care of it.",
    'This will be fully covered.',
    'It will be 100% covered by your policy.',
    'We guarantee your claim gets approved.',
    'Your claim will be approved.',
    'We will get your claim approved.',
  ]

  it.each(banned)('refuses: %s', (text) => {
    expect(checkLanguage(text).ok).toBe(false)
  })

  it('explains why, and offers something true to say instead', () => {
    const result = checkLanguage('Insurance will pay for all of it.')
    expect(result.ok).toBe(false)
    if (result.ok) return
    const violation = result.violations[0]
    expect(violation?.because).toMatch(/carrier|policy/i)
    // A refusal with no alternative just gets worked around.
    expect(violation?.insteadSay.length).toBeGreaterThan(20)
  })
})

describe('what remains sayable', () => {
  const allowed = [
    'We document the damage and give your carrier a complete package to review.',
    'Your deductible is the part you pay.',
    'Hail of 1.75 inches was officially reported 0.8 miles from here.',
    'We can tell you how strong the documentation is, and what is still uncertain.',
    'Your policy and the adjuster’s findings decide what is covered.',
    'We found conditions on this roof that deserve a closer look.',
    'Prior claims may affect underwriting or premiums depending on the carrier and the situation.',
    'We help identify missing documentation and legitimate supplement opportunities.',
    'Delta Ridge combines storm data, roof measurements and imagery into one evidence package.',
  ]

  it.each(allowed)('allows: %s', (text) => {
    const result = checkLanguage(text)
    if (!result.ok) {
      throw new Error(`wrongly refused: ${result.violations.map((v) => v.matched).join(', ')}`)
    }
    expect(result.ok).toBe(true)
  })

  it('does not treat discussing insurance as promising an outcome', () => {
    // The product IS insurance documentation. A guard that blocks the word
    // "insurance" would make the software useless and get switched off.
    expect(checkLanguage('We will send this to your insurance carrier.').ok).toBe(true)
    expect(checkLanguage('Your insurance adjuster will inspect the roof.').ok).toBe(true)
  })
})

describe('the deductible', () => {
  it('refuses every way of offering to absorb it', () => {
    // Criminal in several states, a licensing matter in most of the rest, and
    // the single most common thing a storm-chasing rep says.
    expect(kindsIn('We can waive your deductible.')).toContain('deductible_inducement')
    expect(kindsIn("We'll cover the deductible for you.")).toContain('deductible_inducement')
    expect(kindsIn("Don't worry about the deductible — that's on us.")).toContain(
      'deductible_inducement',
    )
    expect(kindsIn('No need to pay your deductible.')).toContain('deductible_inducement')
  })

  it('still lets a rep explain what a deductible is', () => {
    expect(checkLanguage('Your deductible is $2,500 and applies before the carrier pays.').ok).toBe(
      true,
    )
  })
})

describe('asserting damage nobody has established', () => {
  it('refuses saying a storm damaged this specific roof', () => {
    expect(kindsIn('Your roof was damaged in the March hail.')).toContain('asserts_unproven_damage')
    expect(kindsIn('This roof has been destroyed.')).toContain('asserts_unproven_damage')
  })

  it('refuses putting a hail report on one house', () => {
    // A report says where a person observed hail, not what fell on one roof.
    expect(kindsIn('1.75 inch hail hit your house.')).toContain('asserts_unproven_damage')
    expect(kindsIn('2" hail struck this property.')).toContain('asserts_unproven_damage')
  })

  it('allows the accurate version of the same fact', () => {
    expect(
      checkLanguage('1.75 inch hail was officially reported 0.8 miles away on 31 March.').ok,
    ).toBe(true)
    expect(
      checkLanguage('MRMS estimated roughly 1.4 inch hail over this grid square.').ok,
    ).toBe(true)
  })

  it('refuses diagnosing a roof before looking at it', () => {
    expect(kindsIn('You definitely need a new roof.')).toContain('asserts_unproven_damage')
  })
})

describe('manufactured urgency', () => {
  it('refuses invented deadlines', () => {
    expect(kindsIn('Sign today or the price goes up.')).toContain('false_urgency')
    expect(kindsIn('This is your last chance.')).toContain('false_urgency')
    expect(kindsIn("Act before it's too late.")).toContain('false_urgency')
  })

  it('allows a real policy deadline', () => {
    expect(
      checkLanguage('Most policies limit how long after a loss you can file — we can find yours.').ok,
    ).toBe(true)
  })
})

describe('claims of a perfect record', () => {
  it('refuses universal success and universal superiority', () => {
    expect(kindsIn('We win every claim.')).toContain('guarantees_success')
    expect(kindsIn('We never lose a claim.')).toContain('guarantees_success')
    expect(kindsIn('We beat every competitor in town.')).toContain('guarantees_success')
  })

  it('allows a factual description of what is different', () => {
    expect(
      checkLanguage(
        'Rather than a visual sales inspection alone, we combine property records, storm history and roof measurements.',
      ).ok,
    ).toBe(true)
  })
})

describe('permittedCopyStrength', () => {
  const posture = (over: Partial<EvidencePosture>): EvidencePosture => ({
    stormTier: 'B',
    hasPostStormImagery: false,
    roofInspected: false,
    ...over,
  })

  it('permits nothing when there is no storm evidence', () => {
    expect(permittedCopyStrength(posture({ stormTier: 'E' }))).toBe('nothing_yet')
  })

  it('permits talking about the storm, not the roof, before anybody has looked', () => {
    // The distinction the whole module exists for: a storm is a reason to ask
    // for a look, not a finding about a roof.
    expect(permittedCopyStrength(posture({ stormTier: 'A' }))).toBe('storm_only')
    expect(permittedCopyStrength(posture({ stormTier: 'C' }))).toBe('storm_only')
  })

  it('still refuses damage language on strong storm evidence alone', () => {
    expect(
      permittedCopyStrength(posture({ stormTier: 'A', hasPostStormImagery: true })),
    ).not.toBe('documented')
  })

  it('permits documented language only once somebody has looked, after the storm', () => {
    expect(
      permittedCopyStrength(posture({ stormTier: 'A', hasPostStormImagery: true, roofInspected: true })),
    ).toBe('documented')
  })

  it('refuses documented language when the only imagery predates the storm', () => {
    // Impeccably hedged copy about storm damage is still dishonest when the
    // pictures were taken before the storm.
    expect(
      permittedCopyStrength(posture({ stormTier: 'A', hasPostStormImagery: false, roofInspected: true })),
    ).toBe('storm_only')
  })

  it('treats weak evidence as nothing yet', () => {
    expect(permittedCopyStrength(posture({ stormTier: 'D' }))).toBe('nothing_yet')
  })
})
