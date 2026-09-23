import type { PermitRecord } from '@/integrations/permits/types'
import type { OccupancyBasis, OccupancyStatus, OwnerKind, ParcelRecord } from '@/integrations/parcel'
import type { StormEvent } from '@/integrations/storm/types'
import { type Fact, missing, SOURCES, sourced } from '@/lib/provenance'

/**
 * Everything the app can honestly say about one address, with the source of
 * every claim attached.
 *
 * This is the layer between four raw feeds and a screen a rep reads in five
 * seconds in a driveway. Its job is not to fill in a Zillow-shaped form. Its
 * job is to state exactly what is known, exactly what was checked and found
 * empty, and exactly what this application cannot see at all — and to keep
 * those three apart, because a rep who is shown a guess as a fact will repeat
 * it to a homeowner and be wrong out loud.
 *
 * What the free public sources genuinely cover, measured not assumed:
 *
 *   owner name, owner mailing address     parish assessor, 100% / 99%
 *   owner-occupancy                       homestead exemption, 63% of parcels
 *   assessed value, land value            parish assessor, 100%
 *   parcel boundary and centroid          parish assessor, geometry
 *   subdivision, flood zone, legal         parish assessor, 99% / 100%
 *   year built                            permit feed, new-build permits only
 *   re-roof history                       permit feed, 1,845 records
 *   hail and wind                         NWS storm reports
 *
 * What they do NOT cover, at any price short of a licensed provider:
 *
 *   bedrooms, bathrooms, living area, lot size, stories, construction type,
 *   roof material, roof pitch, sale price, sale history, market value
 *
 * Those are represented as `unavailable`, never as a blank and never as an
 * estimate. The distinction is the whole design.
 */

export interface OwnerProfile {
  name: Fact<string>
  kind: OwnerKind
  mailingAddress: Fact<string>
  occupancy: Fact<OccupancyStatus>
  occupancyBasis: OccupancyBasis
}

export interface RoofProfile {
  /** Year the house was first permitted. The only free age anchor there is. */
  yearBuilt: Fact<number>
  /** When a re-roof permit was last issued at this address. */
  lastReroofAt: Fact<string>
  /** Years on the current roof, derived. Always `estimated`, never verified. */
  ageYears: Fact<number>
  /** Every roofing permit found, newest first. */
  permits: readonly PermitRecord[]
  /** Who pulled the last roofing permit here. Competitive intelligence. */
  lastContractor: Fact<string>
}

export interface PropertyProfile {
  address: string
  addressKey: string | null
  parcelNumber: Fact<string>
  subdivision: Fact<string>
  floodZone: Fact<string>
  assessedValue: Fact<number>
  landValue: Fact<number>
  latitude?: number
  longitude?: number
  boundary?: ReadonlyArray<readonly [number, number]>
  owner: OwnerProfile
  roof: RoofProfile
  storms: readonly StormEvent[]
  /**
   * Fields this application cannot source at all today, named individually so
   * the property screen can say WHY a section is empty instead of showing a
   * row of dashes.
   */
  unavailable: readonly UnavailableField[]
}

export interface UnavailableField {
  readonly field: string
  readonly label: string
  readonly reason: string
}

/**
 * The honest list, written once.
 *
 * Every entry here was checked against the live parish service on 2026-09-23:
 * the East Baton Rouge parcel layer has no column for any of them, and the
 * permit feed carries none of them either. Filling them needs a licensed
 * property-data provider under contract.
 */
export const UNAVAILABLE_WITHOUT_LICENSED_DATA: readonly UnavailableField[] = [
  { field: 'beds', label: 'Bedrooms', reason: 'No public parish source carries it.' },
  { field: 'baths', label: 'Bathrooms', reason: 'No public parish source carries it.' },
  { field: 'livingArea', label: 'Living area', reason: 'No public parish source carries it.' },
  { field: 'lotSize', label: 'Lot size', reason: 'No public parish source carries it.' },
  { field: 'stories', label: 'Stories', reason: 'No public parish source carries it.' },
  { field: 'roofMaterial', label: 'Roof material', reason: 'Not in parcel or permit records.' },
  {
    field: 'saleHistory',
    label: 'Sale history',
    reason: 'The parcel layer returns nothing when its sale field is requested.',
  },
  {
    field: 'marketValue',
    label: 'Market value',
    reason: 'The parish publishes the column but leaves it empty on every parcel.',
  },
] as const

const YEAR_MS = 365.25 * 24 * 3600 * 1000

function yearOf(iso: string): number {
  return new Date(iso).getUTCFullYear()
}

/**
 * Builds the profile.
 *
 * `now` is injected so the age arithmetic is testable and so two properties in
 * the same run are aged against the same instant.
 */
export function buildPropertyProfile(input: {
  address: string
  addressKey: string | null
  parcel?: ParcelRecord
  permits: readonly PermitRecord[]
  storms: readonly StormEvent[]
  now: Date
}): PropertyProfile {
  const { address, addressKey, parcel, permits, storms, now } = input
  const readAt = now.toISOString()
  const parcelSource = SOURCES.ebrParcel(parcel?.retrievedAt ?? readAt)
  const permitSource = SOURCES.ebrPermits(readAt)

  const roofingPermits = [...permits]
    .filter((p) => p.kind === 'reroof' || p.kind === 'new_build')
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))

  const lastReroof = roofingPermits.find((p) => p.kind === 'reroof')
  const build = roofingPermits.find((p) => p.kind === 'new_build')

  // Roof age: since the last re-roof if there was one, otherwise since the
  // house was built. Both are ESTIMATES — a permit records that work was
  // authorised, not that it was done, and a roof replaced without a permit
  // leaves no trace at all. The basis string is what a rep repeats out loud,
  // so it says what was actually found rather than asserting an age.
  const roofAnchor = lastReroof ?? build
  const ageYears: Fact<number> = roofAnchor
    ? sourced(
        Math.floor((now.getTime() - new Date(roofAnchor.issuedAt).getTime()) / YEAR_MS),
        'estimated',
        permitSource,
        lastReroof
          ? `Re-roof permit issued ${lastReroof.issuedAt.slice(0, 10)}; no permit since.`
          : `Built ${build ? build.issuedAt.slice(0, 10) : 'unknown'} with no re-roof permit on file since.`,
      )
    : missing(
        permitSource,
        'No building or re-roof permit is on file for this address, so there is no basis for a roof age.',
      )

  return {
    address,
    addressKey,
    parcelNumber: parcel
      ? sourced(parcel.parcelNumber, 'verified', parcelSource)
      : missing(parcelSource, 'This address was not matched to a parish parcel.'),
    subdivision: parcel?.subdivision
      ? sourced(parcel.subdivision, 'verified', parcelSource)
      : missing(parcelSource, 'The parcel record carries no subdivision.'),
    floodZone: parcel?.floodZone
      ? sourced(parcel.floodZone, 'verified', parcelSource)
      : missing(parcelSource, 'The parcel record carries no flood zone.'),
    assessedValue:
      parcel?.assessedValue !== undefined
        ? sourced(parcel.assessedValue, 'verified', parcelSource)
        : missing(parcelSource, 'The parcel record carries no assessed value.'),
    landValue:
      parcel?.landValue !== undefined
        ? sourced(parcel.landValue, 'verified', parcelSource)
        : missing(parcelSource, 'The parcel record carries no land value.'),
    ...(parcel?.latitude !== undefined ? { latitude: parcel.latitude } : {}),
    ...(parcel?.longitude !== undefined ? { longitude: parcel.longitude } : {}),
    ...(parcel?.boundary ? { boundary: parcel.boundary } : {}),

    owner: {
      name: parcel
        ? sourced(parcel.ownerName, 'verified', parcelSource)
        : missing(
            parcelSource,
            'No parish parcel matched this address, so there is no recorded owner to show.',
          ),
      kind: parcel?.ownerKind ?? 'unknown',
      mailingAddress: parcel?.ownerMailingAddress
        ? sourced(
            [parcel.ownerMailingAddress.trim(), parcel.ownerMailingCityStateZip]
              .filter(Boolean)
              .join(', '),
            'verified',
            parcelSource,
          )
        : missing(parcelSource, 'The parcel record carries no owner mailing address.'),
      occupancy: parcel
        ? sourced(
            parcel.occupancy,
            // A homestead exemption is a filing, so it is verified. An address
            // comparison is our own inference, so it is only ever an estimate.
            parcel.occupancyBasis === 'homestead_exemption' ? 'verified' : 'estimated',
            parcelSource,
            occupancyBasisText(parcel.occupancyBasis),
          )
        : missing(parcelSource, 'No parish parcel matched this address.'),
      occupancyBasis: parcel?.occupancyBasis ?? 'unknown',
    },

    roof: {
      yearBuilt: build
        ? sourced(
            yearOf(build.issuedAt),
            'estimated',
            permitSource,
            `First building permit issued ${build.issuedAt.slice(0, 10)}.`,
          )
        : missing(
            permitSource,
            'No original building permit is on file, which is normal for houses built before the parish digitised its records.',
          ),
      lastReroofAt: lastReroof
        ? sourced(lastReroof.issuedAt, 'verified', permitSource)
        : missing(
            permitSource,
            'No re-roof permit is on file for this address in East Baton Rouge.',
          ),
      ageYears,
      permits: roofingPermits,
      lastContractor: lastReroof?.contractorName
        ? sourced(lastReroof.contractorName, 'verified', permitSource)
        : missing(permitSource, 'No re-roof permit on file, so no contractor to name.'),
    },

    storms: [...storms].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    unavailable: UNAVAILABLE_WITHOUT_LICENSED_DATA,
  }
}

function occupancyBasisText(basis: OccupancyBasis): string {
  switch (basis) {
    case 'homestead_exemption':
      return 'A homestead exemption is filed on this parcel, which Louisiana grants only on a primary residence.'
    case 'mailing_matches':
      return 'The tax bill goes to the property address.'
    case 'mailing_differs':
      return 'The tax bill goes somewhere else. That often means a rental, but a PO box looks the same.'
    case 'unknown':
      return 'The parcel record gives no occupancy signal either way.'
  }
}
