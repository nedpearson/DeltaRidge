import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENRICHMENT,
  mayEnrich,
  mayEnterManually,
  maySpendOnSecondary,
  type EnrichmentConfig,
} from '@/features/contacts/enrichment'

/**
 * These tests are the enforcement. The clause they encode — BeenVerified's
 * consumer terms banning "professional, commercial, business ... lead-list
 * generating" use — is the reason a paid subscription the operator already
 * holds cannot feed this app, and it is exactly the kind of finding that gets
 * forgotten on a busy afternoon six months from now.
 */

const business: EnrichmentConfig = {
  entitlement: 'business_api',
  credentialPresent: true,
  commercialUseConfirmed: true,
  secondaryProvidersEnabled: false,
}

describe('mayEnrich', () => {
  it('refuses by default', () => {
    expect(mayEnrich(DEFAULT_ENRICHMENT).allowed).toBe(false)
  })

  it('refuses a consumer subscription even though it is paid for and working', () => {
    const verdict = mayEnrich({ ...DEFAULT_ENRICHMENT, entitlement: 'consumer_subscription' })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toMatch(/commercial|lead-list/i)
    // The refusal has to point somewhere real, or it just reads as breakage.
    expect(verdict.remedy).toContain('business.beenverified.com')
  })

  it('still refuses a consumer subscription that has a credential sitting there', () => {
    // The tempting state: a key exists, the endpoint answers. The terms are
    // what is missing, and no amount of configuration supplies them.
    const verdict = mayEnrich({
      entitlement: 'consumer_subscription',
      credentialPresent: true,
      commercialUseConfirmed: true,
      secondaryProvidersEnabled: true,
    })
    expect(verdict.allowed).toBe(false)
  })

  it('refuses a business plan with no credential on the server', () => {
    expect(mayEnrich({ ...business, credentialPresent: false }).allowed).toBe(false)
  })

  it('refuses a business credential nobody has vouched for', () => {
    const verdict = mayEnrich({ ...business, commercialUseConfirmed: false })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.reason).toMatch(/confirmed/i)
  })

  it('allows only a confirmed business agreement with a credential', () => {
    expect(mayEnrich(business)).toEqual({ allowed: true })
  })

  it('has no configuration that allows without a human confirmation', () => {
    // Exhaustive over the flags: the only true is the one above.
    const flags = [true, false]
    const allowed: EnrichmentConfig[] = []
    for (const entitlement of ['none', 'consumer_subscription', 'business_api'] as const) {
      for (const credentialPresent of flags) {
        for (const commercialUseConfirmed of flags) {
          for (const secondaryProvidersEnabled of flags) {
            const config = {
              entitlement,
              credentialPresent,
              commercialUseConfirmed,
              secondaryProvidersEnabled,
            }
            if (mayEnrich(config).allowed) allowed.push(config)
          }
        }
      }
    }
    expect(allowed).toHaveLength(2) // business_api + credential + confirmed, x2 secondary flag
    for (const config of allowed) {
      expect(config.entitlement).toBe('business_api')
      expect(config.credentialPresent).toBe(true)
      expect(config.commercialUseConfirmed).toBe(true)
    }
  })
})

describe('mayEnterManually', () => {
  it('always allows what the homeowner said', () => {
    expect(mayEnterManually('homeowner', DEFAULT_ENRICHMENT)).toEqual({ allowed: true })
  })

  it('always allows a public record', () => {
    expect(mayEnterManually('public_record', DEFAULT_ENRICHMENT)).toEqual({ allowed: true })
  })

  it('refuses typing in a consumer BeenVerified result by hand', () => {
    /*
     * The one that matters most, and the least obvious.
     *
     * "Manual entry" sounds like a safe fallback for a blocked API. It is not,
     * because the prohibited thing is the PURPOSE — building a call list for a
     * business — and a rep reading the report on their phone and typing the
     * number in is doing that just as much as a script would be.
     */
    const verdict = mayEnterManually('beenverified_manual', {
      ...DEFAULT_ENRICHMENT,
      entitlement: 'consumer_subscription',
    })
    expect(verdict.allowed).toBe(false)
  })

  it('allows a provider entry once a business agreement is in place', () => {
    expect(mayEnterManually('beenverified_manual', business)).toEqual({ allowed: true })
  })
})

describe('maySpendOnSecondary', () => {
  it('is off even when the primary is fully authorised', () => {
    expect(maySpendOnSecondary(business).allowed).toBe(false)
  })

  it('still needs the primary gate once switched on', () => {
    // Turning on fallbacks must not become a way around the entitlement check.
    expect(
      maySpendOnSecondary({
        ...DEFAULT_ENRICHMENT,
        entitlement: 'consumer_subscription',
        secondaryProvidersEnabled: true,
      }).allowed,
    ).toBe(false)
  })

  it('allows when enabled and the primary gate passes', () => {
    expect(maySpendOnSecondary({ ...business, secondaryProvidersEnabled: true })).toEqual({
      allowed: true,
    })
  })
})
