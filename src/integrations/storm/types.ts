/**
 * StormProvider — the seam that keeps storm intelligence swappable.
 *
 * Why this exists: HailTrace's public API surface is thin and its pricing tier
 * for API access is not published, so the product cannot depend on it. NOAA /
 * SPC storm reports are free and public and good enough to prove the map's
 * value. Both sit behind this interface, selected by env, so switching is a
 * config change rather than a rewrite.
 */

export type StormEventType = 'hail' | 'wind' | 'tornado' | 'other'

export interface StormEvent {
  /** Provider-scoped stable id, so re-ingestion is idempotent. */
  externalId: string
  provider: StormProviderId
  eventType: StormEventType
  occurredAt: string
  /** Hail diameter in inches. 1.75"+ reliably damages asphalt shingle. */
  hailSizeInches?: number
  windSpeedMph?: number
  latitude: number
  longitude: number
  city?: string
  countyParish?: string
  state?: string
  magnitudeNote?: string
}

/**
 * Area geometry is returned separately from event metadata, and carries an
 * explicit flag saying whether it may be persisted. Some providers licence
 * geometry for display only. The database enforces this too
 * (see app.enforce_geometry_licence) so a mistake here cannot quietly
 * create a licensing problem.
 */
export interface StormGeometry {
  externalId: string
  provider: StormProviderId
  geojson: unknown
  mayPersist: boolean
  attribution: string
}

export type StormProviderId = 'noaa' | 'hailtrace'

export interface StormQuery {
  /** Bounding box: [west, south, east, north] */
  bbox: [number, number, number, number]
  from: string
  to: string
  eventTypes?: StormEventType[]
  minHailSizeInches?: number
}

/**
 * Availability is a first-class, inspectable state rather than an exception.
 * The UI renders "Storm data unavailable — NOAA provider not configured" instead
 * of an error boundary, and the rest of the app carries on.
 */
export interface ProviderAvailability {
  available: boolean
  /** Shown to the user verbatim. Must be plain language, never a stack trace. */
  reason?: string
  /** True when the operator can fix this themselves (e.g. add a key). */
  actionable?: boolean
}

export interface StormProvider {
  readonly id: StormProviderId
  readonly displayName: string
  readonly attribution: string
  /** Whether this provider's geometry may be written to our database. */
  readonly mayPersistGeometry: boolean
  availability(): Promise<ProviderAvailability>
  searchEvents(query: StormQuery): Promise<StormEvent[]>
  /** Returns null when the provider offers no geometry for the event. */
  eventGeometry(externalId: string): Promise<StormGeometry | null>
}
