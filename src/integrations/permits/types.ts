import type { ProviderAvailability } from '@/integrations/storm/types'

/**
 * PermitProvider — public building-permit records, behind a seam.
 *
 * Why permits are the centre of lead generation and not an afterthought:
 *
 *   * They are the only free signal for roof AGE in this market. No parish
 *     parcel layer we can reach publishes `year_built`, but a permit says
 *     exactly when a roof was put on or replaced.
 *   * They are the only free way to SUPPRESS. A re-roof permit dated after the
 *     storm means that roof is already done. Every competitor's storm list
 *     still has that door on it; ours does not.
 *   * They are competitive intelligence. The contractor name is on the record,
 *     so who is winning which subdivision, and how fast they move after a
 *     storm, is a query rather than a rumour.
 *
 * East Baton Rouge publishes all of this on a Socrata endpoint with no key and
 * an open CORS policy, which is why the first implementation needs no backend.
 * Ascension made re-roof permits mandatory in August 2025 but exposes no public
 * API yet, and Livingston is view-only — so coverage is deliberately reported
 * per parish rather than implied.
 */

export type PermitKind = 'reroof' | 'new_build' | 'other'

export interface PermitRecord {
  /** Provider-scoped stable id, so re-fetching is idempotent. */
  externalId: string
  provider: PermitProviderId
  kind: PermitKind
  /** Raw permit type as the parish words it, kept for display and audit. */
  permitType: string
  issuedAt: string
  address: string
  /** Normalised for matching — see src/lib/address.ts. */
  addressKey: string | null
  city?: string
  postalCode?: string
  latitude?: number
  longitude?: number
  projectValue?: number
  contractorName?: string
  ownerName?: string
  subdivision?: string
}

export type PermitProviderId = 'ebr'

export interface PermitQuery {
  /** Bounding box: [west, south, east, north] */
  bbox?: [number, number, number, number]
  kinds: PermitKind[]
  issuedFrom?: string
  issuedTo?: string
  /** Hard ceiling on rows pulled, so a phone on a hotspot cannot be swamped. */
  limit?: number
}

export interface PermitProvider {
  readonly id: PermitProviderId
  readonly displayName: string
  readonly attribution: string
  /** Which parishes this provider actually covers, in plain language. */
  readonly coverage: string
  availability(): Promise<ProviderAvailability>
  search(query: PermitQuery): Promise<PermitRecord[]>
}
