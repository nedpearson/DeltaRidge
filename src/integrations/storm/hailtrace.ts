import type {
  ProviderAvailability,
  StormEvent,
  StormGeometry,
  StormProvider,
  StormQuery,
} from './types'

/**
 * HailTrace provider — intentionally unimplemented.
 *
 * As of 2026-09-18 (see docs/INTEGRATION_RESEARCH.md) HailTrace's public API
 * documentation exposes essentially one endpoint (order a hail history report
 * PDF). The event-search and per-property impact-history surface this product
 * would need is not publicly documented, its authentication method is not
 * stated, and no plan tier publicly advertises API access.
 *
 * Rather than code against a guessed API shape, this class satisfies the
 * interface and reports itself unavailable with an actionable reason. When Delta
 * Ridge has a subscription and real documentation, implement the three methods
 * below; nothing else in the application changes.
 *
 * IMPORTANT on geometry: mayPersistGeometry stays false until the subscription
 * agreement is confirmed in writing to permit storage. The database enforces
 * this independently (app.enforce_geometry_licence), so flipping this flag alone
 * is not enough — storm_providers.geometry_storage_allowed must also be updated
 * deliberately.
 */
export class HailTraceStormProvider implements StormProvider {
  readonly id = 'hailtrace' as const
  readonly displayName = 'HailTrace'
  readonly attribution = 'Weather data provided by HailTrace'
  readonly mayPersistGeometry = false

  private readonly unavailable: ProviderAvailability = {
    available: false,
    reason:
      'HailTrace is not connected. Its API requires a paid subscription and credentials that have not been ' +
      'configured. Storm history is coming from free NOAA storm reports instead.',
    actionable: true,
  }

  async availability(): Promise<ProviderAvailability> {
    return this.unavailable
  }

  async searchEvents(_query: StormQuery): Promise<StormEvent[]> {
    // Returning empty rather than throwing: an unconfigured premium provider is
    // a normal state, not an error the field UI should surface as a crash.
    return []
  }

  async eventGeometry(_externalId: string): Promise<StormGeometry | null> {
    return null
  }
}
