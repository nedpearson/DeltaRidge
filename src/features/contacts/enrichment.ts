/**
 * Where a homeowner's phone number may come from, and on whose authority.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE RESEARCH FOUND, 23 September 2026
 * ---------------------------------------------------------------------------
 *
 * BeenVerified does operate a current, documented API. The spec is public at
 * apidocs.beenverified.com, the endpoint is POST api.beenverified.com/v1/append,
 * and an address plus `include: ["contact","owners_residents"]` is exactly the
 * address-to-homeowner-phone lookup this business wants. That part of the plan
 * was right, and better than expected.
 *
 * The problem is not the API. It is the subscription underneath it.
 *
 * BeenVerified's consumer Terms (last updated 23 October 2025) say the service
 * is "intended for personal individual use rather than for professional
 * purposes", and clause XIX prohibits use "for professional, commercial,
 * business, governmental, collections, marketing, lead-list generating,
 * advertising or broker/reseller services purposes."
 *
 * Read that list again slowly. A roofing company building a call list is inside
 * it four separate ways: professional, commercial, business, and lead-list
 * generating. This is not a clause about scraping — automation is banned
 * separately, in clause VIII. It is a clause about the PURPOSE, and it applies
 * whether the data arrives by API, by bulk upload, or by a person reading the
 * screen and typing what they see.
 *
 * So the honest position is narrower than "get an API key":
 *
 *   A consumer BeenVerified subscription cannot lawfully feed Delta Ridge,
 *   by any mechanism, however manual.
 *
 * There is a legitimate path. business.beenverified.com sells to Home Services
 * by name — "Access homeowner phone numbers and contact details to improve
 * prospecting" — and API access is an account entitlement granted through their
 * sales process, under a separate agreement that is not published. That
 * agreement, not the consumer Terms, would govern. Until somebody has signed it,
 * this module refuses.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT A NOTE IN A README
 * ---------------------------------------------------------------------------
 *
 * Because the failure mode is a busy afternoon. Somebody pastes a key into an
 * environment variable, the lookups start working, nobody re-reads a terms page
 * from last October, and six months later there are forty thousand rows in a
 * database that were not permitted to be collected. The refusal has to live in
 * the code path, not in a person's memory.
 */

export type EnrichmentEntitlement =
  /** Nothing configured. The ordinary state. */
  | 'none'
  /**
   * Somebody has a BeenVerified login and a paid consumer plan.
   *
   * This is deliberately NOT a usable state. It exists so the app can say
   * exactly why it will not use a subscription the operator is already paying
   * for, which is a question that otherwise gets asked every few weeks.
   */
  | 'consumer_subscription'
  /**
   * An API key issued under a business agreement, which an admin has confirmed
   * covers commercial prospecting. Confirmed by a person, because no API
   * response tells you what contract you signed.
   */
  | 'business_api'

export interface EnrichmentConfig {
  readonly entitlement: EnrichmentEntitlement
  /** Whether a server-side credential is actually present. */
  readonly credentialPresent: boolean
  /**
   * An admin ticking "our agreement with this provider permits commercial
   * prospecting". Recorded with who and when, elsewhere; this is the flag.
   */
  readonly commercialUseConfirmed: boolean
  /** Paid providers other than the primary. Off unless an admin turns them on. */
  readonly secondaryProvidersEnabled: boolean
}

const KNOWN_ENTITLEMENTS: ReadonlySet<string> = new Set<EnrichmentEntitlement>([
  'none',
  'consumer_subscription',
  'business_api',
])

export const DEFAULT_ENRICHMENT: EnrichmentConfig = {
  entitlement: 'none',
  credentialPresent: false,
  commercialUseConfirmed: false,
  // Defaults to off, as instructed, and stays off until somebody chooses
  // otherwise and pays for it knowingly.
  secondaryProvidersEnabled: false,
}

export type EnrichmentVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      /** One sentence a non-lawyer can act on. */
      readonly reason: string
      /** What would actually change the answer. Never "contact support". */
      readonly remedy: string
    }

/**
 * May an automated lookup run at all?
 *
 * Every branch below refuses by default. There is no path through this function
 * that returns allowed without both a credential and a human confirmation that
 * the agreement behind it permits this use.
 */
export function mayEnrich(config: EnrichmentConfig): EnrichmentVerdict {
  /*
   * A value outside the union refuses rather than falling off the end.
   *
   * The switch below is exhaustive over the declared type, which is why the
   * compiler accepted it with no default — but `entitlement` arrives from a
   * database column, and nothing parses it. A row reading 'trial' returned
   * `undefined` from this function, and the next line to touch `.allowed`
   * threw. A crash is not an authorisation bypass, but the premise of this
   * file is that the refusal must be un-bypassable, and "throws on an
   * unexpected input" is not the same as "refuses".
   */
  if (!KNOWN_ENTITLEMENTS.has(config.entitlement)) {
    return {
      allowed: false,
      reason: 'The recorded provider entitlement is not one this app understands.',
      remedy: 'Set it again on the integrations screen.',
    }
  }

  switch (config.entitlement) {
    case 'none':
      return {
        allowed: false,
        reason: 'No contact-data provider is connected.',
        remedy:
          'Numbers can still be typed in by hand from any source you are entitled to use.',
      }

    case 'consumer_subscription':
      return {
        allowed: false,
        reason:
          'A personal BeenVerified subscription does not permit commercial or lead-list use, ' +
          'so Delta Ridge will not query it — by API or by hand.',
        remedy:
          'BeenVerified sells a business plan to home-services companies, at ' +
          'business.beenverified.com. API access comes with it. That agreement, not the ' +
          'consumer terms, is what would permit this.',
      }

    case 'business_api':
      if (!config.credentialPresent) {
        return {
          allowed: false,
          reason: 'A business plan is recorded but no API credential has been set on the server.',
          remedy: 'Set the provider credential as an Edge Function secret, never in the app.',
        }
      }
      if (!config.commercialUseConfirmed) {
        return {
          allowed: false,
          reason:
            'Nobody has confirmed that the agreement behind this credential covers ' +
            'commercial prospecting.',
          remedy:
            'An admin confirms this once, on the integrations screen, after reading the ' +
            'agreement. No API response can tell us what contract was signed.',
        }
      }
      return { allowed: true }
  }
}

/**
 * Whether a number obtained this way may be entered at all.
 *
 * Distinct from `mayEnrich`, and the distinction matters: clause XIX is about
 * the PURPOSE, not the mechanism. A rep reading a consumer BeenVerified report
 * on their phone and typing the number into Delta Ridge is doing lead-list
 * generation with a personal subscription just as surely as a script would be.
 * So the manual path is gated on entitlement too — it is only unrestricted for
 * sources that carry no such term.
 */
export function mayEnterManually(
  source: ManualEntrySource,
  config: EnrichmentConfig,
): EnrichmentVerdict {
  if (source === 'homeowner' || source === 'public_record') {
    // A homeowner telling a rep their number, or a parish record that is public
    // by statute, is governed by nobody's terms of service.
    return { allowed: true }
  }

  if (source === 'beenverified_manual') {
    /*
     * Asks whether the USE is permitted, not whether an API key exists.
     *
     * This used to delegate wholesale to `mayEnrich`, so an operator who had
     * signed the business agreement but whose API key had not been issued yet
     * was told they could not type in a number they were contractually
     * entitled to type — with a remedy about Edge Function secrets, which has
     * nothing to do with a person filling in a form. The file's own argument is
     * that the mechanism and the permission are different questions; this is
     * the permission one.
     */
    return mayUseProviderData(config)
  }

  return {
    allowed: false,
    reason: 'That source is not one this app records.',
    remedy: 'Use the homeowner, a public record, or a provider under a business agreement.',
  }
}

/**
 * Is this organisation permitted to use this provider's data at all?
 *
 * Separate from `mayEnrich`, which additionally asks whether an automated
 * lookup can run. Clause XIX is about purpose, so this is the question that
 * governs a human typing as well as a script fetching.
 */
export function mayUseProviderData(config: EnrichmentConfig): EnrichmentVerdict {
  if (!KNOWN_ENTITLEMENTS.has(config.entitlement)) {
    return {
      allowed: false,
      reason: 'The recorded provider entitlement is not one this app understands.',
      remedy: 'Set it again on the integrations screen.',
    }
  }
  if (config.entitlement === 'none') {
    return {
      allowed: false,
      reason: 'No contact-data provider is connected.',
      remedy: 'Numbers can still be typed in by hand from any source you are entitled to use.',
    }
  }
  if (config.entitlement === 'consumer_subscription') {
    return {
      allowed: false,
      reason:
        'A personal BeenVerified subscription does not permit commercial or lead-list use, ' +
        'so Delta Ridge will not query it — by API or by hand.',
      remedy:
        'BeenVerified sells a business plan to home-services companies, at ' +
        'business.beenverified.com. API access comes with it. That agreement, not the ' +
        'consumer terms, is what would permit this.',
    }
  }
  if (!config.commercialUseConfirmed) {
    return {
      allowed: false,
      reason: 'Nobody has confirmed that the agreement covers commercial prospecting.',
      remedy: 'An admin confirms this once, on the integrations screen, after reading the agreement.',
    }
  }
  return { allowed: true }
}

export type ManualEntrySource =
  | 'homeowner'
  | 'public_record'
  | 'beenverified_manual'
  | 'other_provider'

/**
 * Whether a second paid provider may be called.
 *
 * Separate from `mayEnrich` because the instruction was explicit: never spend
 * money on a second provider by accident. Enabling it is a deliberate admin act.
 */
export function maySpendOnSecondary(config: EnrichmentConfig): EnrichmentVerdict {
  if (!config.secondaryProvidersEnabled) {
    return {
      allowed: false,
      reason: 'Paid fallback providers are switched off.',
      remedy: 'An admin can enable them on the integrations screen, knowing each call costs money.',
    }
  }
  return mayEnrich(config)
}
