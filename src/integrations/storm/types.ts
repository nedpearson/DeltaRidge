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

/**
 * How an event was observed. This is not a provider name and not a nicety.
 *
 * A ground report is somebody saying hail fell on them. A radar estimate is a
 * model inferring the largest hail aloft inside a storm cell. Those are
 * different claims, they are wrong in different directions, and the product
 * shows them separately everywhere rather than summing them into one number
 * that reads as completeness.
 */
export type HailObservation = 'official_report' | 'radar_estimate'

/** Whether a radar estimate has any ground report standing behind it. */
export type RadarConfidence = 'corroborated' | 'radar_only'

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
  /**
   * Optional only so that a run cached before radar existed still reads. Treat
   * an absent value as 'official_report' — that is all this app had until then.
   */
  observation?: HailObservation
  /** Set on radar estimates only. See RadarConfidence. */
  radarConfidence?: RadarConfidence
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

export type StormProviderId = 'noaa' | 'hailtrace' | 'swdi'

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
