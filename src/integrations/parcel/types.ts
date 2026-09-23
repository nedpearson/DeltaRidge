import type { ProviderAvailability } from '@/integrations/storm/types'

/**
 * ParcelProvider — the assessor's record of who owns a property, behind a seam.
 *
 * This is the layer the door list was missing. Permits say a roof is old and
 * storms say it was hit; neither says whose front door it is, whether they live
 * behind it, or where the parcel's edges are. The parish assessor answers all
 * three, for free, with no key and an open CORS policy.
 *
 * What it is NOT, and must never be dressed up as:
 *
 *   * It is not a property-characteristics source. East Baton Rouge's parcel
 *     layer carries no year built, no bedrooms, no bathrooms, no square
 *     footage and no roof attributes. Anything Zillow-shaped beyond owner,
 *     value and geometry has to come from a licensed provider, and until one
 *     is contracted those fields are absent rather than estimated.
 *   * It is not a sale-history source. See the SALE_YEAR note in ebr.ts.
 *   * It is not proof of occupancy. A homestead exemption is strong evidence
 *     that the owner lives there, and a mailing address matching the property
 *     is weaker evidence of the same. Neither is a fact about who opens the
 *     door, so occupancy is reported with its basis attached.
 *
 * The seam exists because Ascension and Livingston will need different
 * implementations — Ascension has its own REST service, Livingston has no
 * public API at all — and because a licensed provider may later stand behind
 * the same interface without the lead engine noticing.
 */

export type ParcelProviderId = 'ebr' | 'ascension' | 'regrid'

/**
 * How confident we are that the owner named here is the owner today.
 *
 * Never inferred from the name itself. It reflects how the record was matched
 * and how fresh the roll is, and it is carried to the screen so a rep is never
 * shown a name as certain when the match was fuzzy.
 */
export type OwnerConfidence = 'high' | 'medium' | 'low'

/**
 * Why we believe the owner lives there — or does not.
 *
 * `homestead_exemption` is the strongest free signal in this market: Louisiana
 * grants it only on a primary residence, so its presence is a deliberate
 * filing by the owner rather than an inference of ours. `mailing_matches` is
 * weaker and `mailing_differs` weaker still in the other direction, because
 * owners routinely use a PO box or a manager's address without moving out.
 */
export type OccupancyBasis =
  | 'homestead_exemption'
  | 'mailing_matches'
  | 'mailing_differs'
  | 'unknown'

export type OccupancyStatus = 'owner_occupied' | 'likely_absentee' | 'unknown'

/** An owner that is plainly an entity rather than a person. */
export type OwnerKind = 'person' | 'trust' | 'company' | 'government' | 'unknown'

export interface ParcelRecord {
  /** Provider-scoped stable id, so re-fetching is idempotent. */
  externalId: string
  provider: ParcelProviderId
  /** Assessor's parcel number as the parish writes it. */
  parcelNumber: string
  /** Situs address, exactly as the roll spells it. */
  address: string
  /** Normalised for matching — see src/lib/address.ts. */
  addressKey: string | null
  city?: string
  postalCode?: string
  parish: string

  /** Recorded owner, verbatim. Never reformatted into a first/last guess. */
  ownerName: string
  ownerKind: OwnerKind
  ownerConfidence: OwnerConfidence
  /** Where the tax bill goes. Street line only; city/state/zip is separate. */
  ownerMailingAddress?: string
  ownerMailingCityStateZip?: string

  occupancy: OccupancyStatus
  occupancyBasis: OccupancyBasis
  /** Dollar value of the homestead exemption, when the roll carries one. */
  homesteadExemption?: number

  subdivision?: string
  lot?: string
  block?: string
  legalDescription?: string
  floodZone?: string

  /**
   * Assessed value. This is the ONLY value field East Baton Rouge actually
   * populates — improvement value and fair-market value exist as columns and
   * are empty on every record sampled, so neither is exposed here.
   */
  assessedValue?: number
  landValue?: number

  /** Parcel centroid, WGS84. Beats geocoding: it is the parcel, not a guess. */
  latitude?: number
  longitude?: number
  /** Outer ring, [lon, lat] pairs, for drawing the boundary over imagery. */
  boundary?: ReadonlyArray<readonly [number, number]>

  /** When this row was read from the parish. */
  retrievedAt: string
}

export interface ParcelQuery {
  /** Bounding box: [west, south, east, north] */
  bbox?: [number, number, number, number]
  /** Match on situs address. Substring, case-insensitive, parish-spelled. */
  addressLike?: string
  /** Exact parcel numbers. */
  parcelNumbers?: readonly string[]
  /** Hard ceiling on rows, so a phone on a hotspot cannot be swamped. */
  limit?: number
  /** Ask for boundary rings. Costs bytes; off unless the map needs them. */
  includeGeometry?: boolean
}

export interface ParcelProvider {
  readonly id: ParcelProviderId
  readonly displayName: string
  readonly attribution: string
  /** Which parishes this provider actually covers, in plain language. */
  readonly coverage: string
  /** Whether this provider's terms allow storing what it returns. */
  readonly mayPersist: boolean
  availability(): Promise<ProviderAvailability>
  search(query: ParcelQuery): Promise<ParcelRecord[]>
  /**
   * Owner and coordinates for a known list of street addresses, batched.
   * Keyed by the uppercased street line the provider matched on.
   */
  lookupByAddresses(streetLines: readonly string[]): Promise<Map<string, ParcelRecord>>
}
