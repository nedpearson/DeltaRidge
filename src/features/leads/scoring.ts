import type { PermitRecord } from '@/integrations/permits/types'
import { streetLineOf } from '@/integrations/geocode/ebr'
import type { ParcelRecord } from '@/integrations/parcel'
import type { StormEvent } from '@/integrations/storm/types'

/**
 * Lead prioritisation.
 *
 * THIS IS NOT A MODEL AND MUST NEVER BE PRESENTED AS ONE. There are no
 * closed-won outcomes in this system yet, so a probability would be an invented
 * number wearing a confidence display. What this produces is a deterministic,
 * fully explainable priority index: every component is stored on the lead, and
 * every lead carries the plain-English reasons it ranked where it did. When
 * real outcomes exist the weights can be fitted against them and these same
 * fields become features with no re-plumbing.
 *
 * The signal is a join no competitor ships:
 *
 *   hail reports  ×  roof age from permit history  −  roofs already replaced
 *
 * The last term is the one that matters most in the field. A re-roof permit
 * dated after the storm means that roof is done. Storm-list vendors sell the
 * address anyway; a rep knocking it wastes the drive and looks uninformed.
 */

export interface ScoringWeights {
  hailSize: number
  hailRecency: number
  proximity: number
  roofAge: number
}

/**
 * Hand-set, not fitted. Labelled as such wherever they surface so nobody
 * mistakes the output for a prediction.
 */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  hailSize: 0.35,
  hailRecency: 0.2,
  proximity: 0.15,
  roofAge: 0.3,
}

export interface LeadCandidate {
  addressKey: string
  address: string
  latitude: number
  longitude: number
  /** The permit that establishes when this roof was last put on. */
  roofPermit: PermitRecord
  city?: string
  postalCode?: string
  subdivision?: string
  /**
   * The assessor's record for this address, when the parcel roll had it.
   *
   * Optional on purpose: about one candidate address in seven is genuinely not
   * on the roll, and a door with no owner is still a door worth knocking. The
   * card shows the address alone rather than dropping the lead.
   */
  parcel?: ParcelRecord
}

/**
 * One line of "why this ranked", in the points a rep sees.
 *
 * Kept as a first-class part of the lead rather than derived in the component,
 * because the number on the card and the numbers in the explanation have to be
 * the same arithmetic. Deriving the explanation separately is how a card ends
 * up showing 84 above a breakdown that adds to 79.
 */
export interface ScoreFactor {
  /** What a rep would call it. */
  label: string
  /** Whole points contributed, out of 100. Signed. */
  points: number
  /** The measurement behind it, stated plainly. */
  detail: string
}

export interface ScoredLead extends LeadCandidate {
  score: number
  /** The score, itemised. Sums to `score`. */
  breakdown: readonly ScoreFactor[]
  /** Inputs kept on the lead so the score can be audited or refitted later. */
  components: {
    hailSizeInches: number
    daysSinceStorm: number
    distanceMiles: number
    roofAgeYears: number
  }
  storm: StormEvent
  /** Plain-English, rep-facing. The UI shows these verbatim. */
  reasons: string[]
}

/**
 * Rounds the parts so they add up to the whole.
 *
 * Rounding each factor independently loses or gains a point or two, and a rep
 * who adds the column and gets 83 under a headline of 84 stops trusting the
 * number — reasonably. The largest remainders absorb the difference.
 */
export function roundToTotal(factors: readonly ScoreFactor[], total: number): ScoreFactor[] {
  const floors = factors.map((f) => ({ ...f, points: Math.floor(f.points) }))
  let deficit = total - floors.reduce((sum, f) => sum + f.points, 0)
  const order = factors
    .map((f, i) => ({ i, remainder: f.points - Math.floor(f.points) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { i } of order) {
    if (deficit <= 0) break
    const target = floors[i]
    if (!target) continue
    target.points += 1
    deficit -= 1
  }
  return floors
}

const EARTH_RADIUS_MILES = 3958.8

export function distanceMiles(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 1.0" is the floor worth a door; 2.5"+ saturates. */
function hailSizeScore(inches: number): number {
  if (inches <= 1) return 0
  return Math.min(1, (inches - 1) / 1.5)
}

/** Fresh damage sells. Decays to zero over two years. */
function recencyScore(days: number): number {
  if (days < 0) return 0
  return Math.max(0, 1 - days / 730)
}

/** Right under the swath beats three miles away. */
function proximityScore(miles: number, radius: number): number {
  if (radius <= 0) return 0
  return Math.max(0, 1 - miles / radius)
}

/**
 * An asphalt roof is a candidate from roughly 12 years and a near-certainty by
 * 25. Below 8 years a hail claim is still possible but a replacement sale is
 * not, so it scores zero rather than a small number.
 */
function roofAgeScore(years: number): number {
  if (years < 8) return 0
  return Math.min(1, (years - 8) / 17)
}

function formatInches(inches: number): string {
  return `${inches.toFixed(inches % 1 === 0 ? 0 : 2).replace(/0$/, '')}"`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export interface ScoreInput {
  candidates: LeadCandidate[]
  storms: StormEvent[]
  /** Re-roof permits, used to suppress roofs already replaced. */
  reroofPermits: PermitRecord[]
  /** How far from a hail report still counts. */
  radiusMiles: number
  minHailInches: number
  now?: Date
  weights?: ScoringWeights
}

export interface ScoreResult {
  leads: ScoredLead[]
  /** Counts for the UI, so the rep can see what the filter actually did. */
  suppressed: {
    alreadyReplaced: number
    noQualifyingHail: number
    roofTooNew: number
  }
}

/**
 * Ranks candidates. Everything here is pure: no fetch, no clock unless passed,
 * no storage. That is deliberate — this is the part most likely to be wrong,
 * and it is the part a test can pin down completely.
 */
export function scoreLeads(input: ScoreInput): ScoreResult {
  const now = input.now ?? new Date()
  const weights = input.weights ?? DEFAULT_WEIGHTS
  const radius = input.radiusMiles

  const hail = input.storms.filter(
    (s) => s.eventType === 'hail' && (s.hailSizeInches ?? 0) >= input.minHailInches,
  )

  // Latest re-roof per address. A roof replaced twice only needs its most
  // recent date to decide whether the storm damage has already been dealt with.
  const latestReroof = new Map<string, string>()
  for (const permit of input.reroofPermits) {
    if (permit.kind !== 'reroof' || !permit.addressKey) continue
    const seen = latestReroof.get(permit.addressKey)
    if (!seen || permit.issuedAt > seen) latestReroof.set(permit.addressKey, permit.issuedAt)
  }

  const leads: ScoredLead[] = []
  const suppressed = { alreadyReplaced: 0, noQualifyingHail: 0, roofTooNew: 0 }

  for (const candidate of input.candidates) {
    // The storm cited has to be the BEST one in range, not the nearest one.
    // Picking by distance alone threw the better storm away before scoring:
    // a dense cluster of 1.0" reports from eighteen months ago out-selected a
    // 1.75" report from last month half a mile further out, so every door on
    // the list cited the same old storm. Score each candidate storm on the
    // three storm-dependent terms and keep the winner; ties break on distance.
    let best: { storm: StormEvent; miles: number; stormScore: number } | null = null
    /** Most recent qualifying storm in range — what suppression must test against. */
    let newestStormAt: string | null = null

    for (const storm of hail) {
      const miles = distanceMiles(candidate.latitude, candidate.longitude, storm.latitude, storm.longitude)
      if (miles > radius) continue

      if (!newestStormAt || storm.occurredAt > newestStormAt) newestStormAt = storm.occurredAt

      const days = (now.getTime() - new Date(storm.occurredAt).getTime()) / (24 * 3600 * 1000)
      const stormScore =
        weights.hailSize * hailSizeScore(storm.hailSizeInches ?? 0) +
        weights.hailRecency * recencyScore(days) +
        weights.proximity * proximityScore(miles, radius)

      if (
        !best ||
        stormScore > best.stormScore ||
        (stormScore === best.stormScore && miles < best.miles)
      ) {
        best = { storm, miles, stormScore }
      }
    }
    if (!best) {
      suppressed.noQualifyingHail += 1
      continue
    }

    // Suppression: a re-roof permit dated after the storm means this roof is
    // already done. This is the single highest-value filter in the engine.
    // It tests the NEWEST storm in range, not the cited one — a roof replaced
    // after an old storm and hit again last month is still a live door.
    const replacedAt = latestReroof.get(candidate.addressKey)
    if (replacedAt && newestStormAt && replacedAt >= newestStormAt) {
      suppressed.alreadyReplaced += 1
      continue
    }

    const roofDateIso = replacedAt ?? candidate.roofPermit.issuedAt
    const roofAgeYears = (now.getTime() - new Date(roofDateIso).getTime()) / (365.25 * 24 * 3600 * 1000)
    if (roofAgeYears < 8) {
      suppressed.roofTooNew += 1
      continue
    }

    const daysSinceStorm = (now.getTime() - new Date(best.storm.occurredAt).getTime()) / (24 * 3600 * 1000)
    const hailSizeInches = best.storm.hailSizeInches ?? 0

    // Storm terms were already solved when this storm was selected; re-deriving
    // them here is how the two could drift apart.
    const score = best.stormScore + weights.roofAge * roofAgeScore(roofAgeYears)

    // Itemised from the same numbers the score is made of, then rounded once so
    // the parts and the total cannot disagree on screen.
    const rawFactors: ScoreFactor[] = [
      {
        label: 'Hail size',
        points: weights.hailSize * hailSizeScore(hailSizeInches) * 100,
        detail: `${formatInches(hailSizeInches)} reported`,
      },
      {
        label: 'Storm recency',
        points: weights.hailRecency * recencyScore(daysSinceStorm) * 100,
        detail: `${Math.round(daysSinceStorm)} days ago`,
      },
      {
        label: 'Close to the report',
        points: weights.proximity * proximityScore(best.miles, radius) * 100,
        detail: `${best.miles.toFixed(1)} mi away`,
      },
      {
        label: 'Roof age',
        points: weights.roofAge * roofAgeScore(roofAgeYears) * 100,
        detail: replacedAt
          ? `about ${Math.round(roofAgeYears)} years since the last re-roof permit`
          : `about ${Math.round(roofAgeYears)} years on the original roof`,
      },
    ]
    const breakdown = roundToTotal(rawFactors, Math.round(score * 100))

    const reasons = [
      `${formatInches(hailSizeInches)} hail reported ${best.miles.toFixed(1)} mi away on ${formatDate(best.storm.occurredAt)}`,
      replacedAt
        ? `Roof last permitted ${formatDate(replacedAt)} — about ${Math.round(roofAgeYears)} years old`
        : `Built ${formatDate(candidate.roofPermit.issuedAt)} with no re-roof permit since — about ${Math.round(roofAgeYears)} years on the original roof`,
      'No re-roof permit on file after this storm',
    ]

    leads.push({
      breakdown,
      ...candidate,
      score: Math.round(score * 100),
      components: {
        hailSizeInches,
        daysSinceStorm: Math.round(daysSinceStorm),
        distanceMiles: Number(best.miles.toFixed(2)),
        roofAgeYears: Number(roofAgeYears.toFixed(1)),
      },
      storm: best.storm,
      reasons,
    })
  }

  leads.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
  return { leads, suppressed }
}

/**
 * Turns new-build permits into candidates, keeping the newest permit per
 * address. Two permits on one lot (a build, then an addition) describe one
 * roof, and the later one is the better age estimate.
 */
export function candidatesFromPermits(
  permits: PermitRecord[],
  parcels: ReadonlyMap<string, ParcelRecord> = new Map(),
): LeadCandidate[] {
  const byAddress = new Map<string, PermitRecord>()
  for (const p of permits) {
    if (p.kind !== 'new_build') continue
    if (p.latitude === undefined || p.longitude === undefined || !p.addressKey) continue
    const seen = byAddress.get(p.addressKey)
    if (!seen || p.issuedAt > seen.issuedAt) byAddress.set(p.addressKey, p)
  }
  return [...byAddress.entries()].map(([addressKey, permit]) => {
    const parcel = parcels.get(streetLineOf(permit.address).toUpperCase())
    return {
      addressKey,
      address: permit.address,
      // The parcel centroid wins where there is one. It is the polygon the
      // parish drew around the house; the permit coordinate is a point the
      // parish placed, and for anything pre-2016 it came from a geocoder
      // interpolating along a street.
      latitude: parcel?.latitude ?? (permit.latitude as number),
      longitude: parcel?.longitude ?? (permit.longitude as number),
      roofPermit: permit,
      ...(permit.city ? { city: permit.city } : {}),
      ...(permit.postalCode ? { postalCode: permit.postalCode } : {}),
      ...(parcel?.subdivision
        ? { subdivision: parcel.subdivision }
        : permit.subdivision
          ? { subdivision: permit.subdivision }
          : {}),
      ...(parcel ? { parcel } : {}),
    }
  })
}

export interface ContractorActivity {
  contractorName: string
  permits: number
  totalValue: number
  subdivisions: string[]
}

/**
 * Who is pulling re-roof permits, and where.
 *
 * This is not scoring — it is the competitive picture, and it is worth showing
 * on its own. The contractor name is on every public permit record, so who is
 * winning which neighbourhood after a storm is a query rather than a rumour.
 */
export function contractorActivity(permits: PermitRecord[], limit = 10): ContractorActivity[] {
  const acc = new Map<string, { permits: number; totalValue: number; subs: Set<string> }>()
  for (const p of permits) {
    if (p.kind !== 'reroof') continue
    const name = (p.contractorName ?? '').trim()
    // 'N/A' is a real and frequent value in the parish feed; counting it as a
    // contractor would put a phantom at the top of the table.
    if (!name || name.toUpperCase() === 'N/A') continue
    const row = acc.get(name) ?? { permits: 0, totalValue: 0, subs: new Set<string>() }
    row.permits += 1
    row.totalValue += p.projectValue ?? 0
    if (p.subdivision) row.subs.add(p.subdivision)
    acc.set(name, row)
  }
  return [...acc.entries()]
    .map(([contractorName, r]) => ({
      contractorName,
      permits: r.permits,
      totalValue: r.totalValue,
      subdivisions: [...r.subs].sort().slice(0, 3),
    }))
    .sort((a, b) => b.permits - a.permits || a.contractorName.localeCompare(b.contractorName))
    .slice(0, limit)
}
