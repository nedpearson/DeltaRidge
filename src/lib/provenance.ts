/**
 * Where a fact came from, carried with the fact.
 *
 * The lead list is about to start mixing four sources — the parish assessor,
 * the parish permit feed, NWS storm reports, and whatever a rep types at the
 * door. They disagree, they go stale at different rates, and they are not
 * equally trustworthy. A screen that prints "Built 2013" without saying which
 * of those said so is asking a rep to defend a number he cannot check.
 *
 * So every externally sourced value on a property profile is wrapped: value,
 * who said it, when we read it, and how sure we are. The wrapper is what makes
 * "Year built: 2013 · Permit record · read today" possible, and it is what
 * stops an estimate from silently hardening into a fact.
 *
 * Deliberately NOT a confidence percentage. There is no model behind these
 * numbers and inventing 82% would be dishonest. Three named levels a rep can
 * reason about are worth more than a fabricated decimal.
 */

export type Certainty =
  /** A record says so. The assessor's owner name, a permit's issue date. */
  | 'verified'
  /** Derived from records by a rule we can state. Roof age from a permit. */
  | 'estimated'
  /** A person said so at the door. Worth a lot, provable by nobody. */
  | 'stated'
  /** We looked and there is nothing. Distinct from never having looked. */
  | 'unknown'

export interface SourceRef {
  /** Short id: 'ebr_parcel', 'ebr_permits', 'noaa_lsr', 'rep'. */
  readonly id: string
  /** What a rep should see: "East Baton Rouge Assessor". */
  readonly label: string
  /** When this application read it. */
  readonly retrievedAt: string
  /** When the source itself says it was last updated, if it says. */
  readonly sourceUpdatedAt?: string
}

export interface Sourced<T> {
  readonly value: T
  readonly certainty: Certainty
  readonly source: SourceRef
  /**
   * Why this value is what it is, in one sentence a rep can repeat out loud.
   * Required on anything `estimated`, because an estimate without its reasoning
   * is indistinguishable from a guess.
   */
  readonly basis?: string
}

/** A fact we looked for and did not find. Never rendered as a zero or a dash. */
export interface Missing {
  readonly value: null
  readonly certainty: 'unknown'
  readonly source: SourceRef
  /** What would have to be true for this to be fillable. */
  readonly basis: string
}

export type Fact<T> = Sourced<T> | Missing

export function sourced<T>(
  value: T,
  certainty: Exclude<Certainty, 'unknown'>,
  source: SourceRef,
  basis?: string,
): Sourced<T> {
  return { value, certainty, source, ...(basis ? { basis } : {}) }
}

/**
 * Records that we looked and found nothing.
 *
 * This exists so the screen can tell two different things apart: "no re-roof
 * permit is on file for this address" (we checked East Baton Rouge's feed
 * today, it is empty) and "we have no permit data for this parish" (Livingston
 * publishes none). The first is a selling point. The second is a gap in the
 * app. Rendering both as a blank makes the rep guess which one he is looking
 * at, and reps guess generously.
 */
export function missing(source: SourceRef, basis: string): Missing {
  return { value: null, certainty: 'unknown', source, basis }
}

export function isKnown<T>(fact: Fact<T> | undefined): fact is Sourced<T> {
  return fact !== undefined && fact.value !== null && fact.certainty !== 'unknown'
}

/** The value if we have one, otherwise undefined. For arithmetic, not display. */
export function valueOf<T>(fact: Fact<T> | undefined): T | undefined {
  return isKnown(fact) ? fact.value : undefined
}

/**
 * Picks between two records of the same fact.
 *
 * Precedence is by certainty first, then recency — NOT by which provider is
 * "better". A rep who stood on the driveway and was told the roof was replaced
 * last year beats a permit feed that has not caught up, and a verified record
 * beats a rule-derived estimate however fresh the estimate is.
 *
 * Nothing is overwritten: the loser is returned too, so the property screen can
 * show both and let a rep see that the sources disagree. Silently collapsing a
 * disagreement is how a list ends up confidently wrong.
 */
export function resolve<T>(
  a: Fact<T> | undefined,
  b: Fact<T> | undefined,
): { chosen: Fact<T> | undefined; conflicting: Fact<T> | undefined } {
  if (a === undefined) return { chosen: b, conflicting: undefined }
  if (b === undefined) return { chosen: a, conflicting: undefined }

  const rank: Record<Certainty, number> = { stated: 3, verified: 2, estimated: 1, unknown: 0 }
  const byRank = rank[a.certainty] - rank[b.certainty]
  if (byRank !== 0) {
    const [chosen, other] = byRank > 0 ? [a, b] : [b, a]
    return { chosen, conflicting: differs(a, b) ? other : undefined }
  }

  const [chosen, other] =
    a.source.retrievedAt >= b.source.retrievedAt ? [a, b] : [b, a]
  return { chosen, conflicting: differs(a, b) ? other : undefined }
}

function differs<T>(a: Fact<T>, b: Fact<T>): boolean {
  return JSON.stringify(a.value) !== JSON.stringify(b.value)
}

/** Sources the app currently reads, so labels are written once. */
export const SOURCES = {
  ebrParcel: (retrievedAt: string): SourceRef => ({
    id: 'ebr_parcel',
    label: 'East Baton Rouge Assessor',
    retrievedAt,
  }),
  ebrPermits: (retrievedAt: string, sourceUpdatedAt?: string): SourceRef => ({
    id: 'ebr_permits',
    label: 'East Baton Rouge permit records',
    retrievedAt,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
  }),
  noaaLsr: (retrievedAt: string): SourceRef => ({
    id: 'noaa_lsr',
    label: 'NWS storm reports',
    retrievedAt,
  }),
  rep: (retrievedAt: string): SourceRef => ({
    id: 'rep',
    label: 'Recorded at the door',
    retrievedAt,
  }),
} as const
