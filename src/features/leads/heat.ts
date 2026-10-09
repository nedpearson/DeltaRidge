/**
 * Inbound inspection-request heat score.
 *
 * WHY THIS EXISTS. Paid storm-lead vendors (RunsForYou, Lead Engine,
 * RainyLeads, StormLead — torn down 2026-10-08) all sell the same thing: a
 * homeowner in a storm-hit area who has said, in their own words, that they
 * own the home, think the roof is damaged, carry insurance, and will meet a
 * roofer. This module turns those answers plus independent storm evidence into
 * one number a rep can sort by, so the hottest request is called first.
 *
 * WHAT IT IS NOT. It never asserts that a homeowner is insured or that a claim
 * will be paid — Louisiana bars contractors from interpreting coverage
 * (La. R.S. 37:2159.1). "Insurance: yes" here is the homeowner's own answer,
 * labelled as such everywhere it is shown.
 *
 * This file is pure and dependency-free on purpose: it is copied verbatim to
 * `supabase/functions/_shared/heat.ts` so the edge function and the app score
 * identically. `heat.test.ts` fails if the two copies drift.
 */

export type DamageAnswer = 'leak' | 'visible' | 'unsure' | 'none'
export type RoofAgeAnswer = 'under5' | '5to10' | '10to15' | 'over15' | 'unknown'
export type InsuranceAnswer = 'yes' | 'no' | 'unsure'
export type ClaimAnswer = 'filed' | 'want_documentation' | 'not_yet'

export interface HeatAnswers {
  readonly owner: boolean
  readonly damage: DamageAnswer
  readonly roofAge: RoofAgeAnswer
  readonly insurance: InsuranceAnswer
  readonly claim: ClaimAnswer
  readonly slotChosen: boolean
  readonly decisionMakersPresent: boolean
}

/** Independent evidence, never from the homeowner. */
export interface HeatStorm {
  /** Largest radar-estimated hail (MEHS, inches) within the search radius. */
  readonly maxHailInches: number | null
  /** Days since that hail day, or null when none was found. */
  readonly daysSince: number | null
  /** True when the lookup itself failed — distinct from "no hail found". */
  readonly unavailable: boolean
}

export type HeatTier = 'hot' | 'warm' | 'cool' | 'not_eligible'

export interface HeatResult {
  readonly score: number
  readonly tier: HeatTier
  readonly reasons: readonly string[]
}

export const HOT_THRESHOLD = 70
export const WARM_THRESHOLD = 45

function stormPoints(storm: HeatStorm): { points: number; reason: string | null } {
  if (storm.unavailable) return { points: 0, reason: 'Storm lookup unavailable — check the map' }
  const size = storm.maxHailInches
  const days = storm.daysSince
  if (size === null || days === null) return { points: 0, reason: null }
  const recent = days <= 365
  if (size >= 1.5 && recent) return { points: 30, reason: `Radar hail ${size.toFixed(2)}" within ${days} days` }
  if (size >= 1.0 && recent) return { points: 20, reason: `Radar hail ${size.toFixed(2)}" within ${days} days` }
  if (size >= 1.0) return { points: 10, reason: `Radar hail ${size.toFixed(2)}" ${days} days ago` }
  return { points: 4, reason: `Small radar hail ${size.toFixed(2)}" on record` }
}

const DAMAGE: Record<DamageAnswer, [number, string | null]> = {
  leak: [20, 'Homeowner reports a leak'],
  visible: [15, 'Homeowner sees damage'],
  unsure: [5, null],
  none: [0, null],
}

const ROOF_AGE: Record<RoofAgeAnswer, [number, string | null]> = {
  over15: [15, 'Roof 15+ years old (homeowner estimate)'],
  '10to15': [10, 'Roof 10–15 years old (homeowner estimate)'],
  '5to10': [4, null],
  under5: [0, null],
  unknown: [5, null],
}

const INSURANCE: Record<InsuranceAnswer, [number, string | null]> = {
  yes: [10, 'Says they carry homeowners insurance'],
  unsure: [4, null],
  no: [0, 'Says no insurance — retail job'],
}

const CLAIM: Record<ClaimAnswer, [number, string | null]> = {
  filed: [10, 'Claim already filed'],
  want_documentation: [8, 'Wants damage documented'],
  not_yet: [4, null],
}

export function scoreHeat(answers: HeatAnswers, storm: HeatStorm): HeatResult {
  if (!answers.owner) {
    return { score: 0, tier: 'not_eligible', reasons: ['Not the homeowner — confirm who owns the home'] }
  }

  const reasons: string[] = []
  let score = 0
  const add = ([points, reason]: [number, string | null]) => {
    score += points
    if (reason) reasons.push(reason)
  }

  const s = stormPoints(storm)
  score += s.points
  if (s.reason) reasons.unshift(s.reason)

  add(DAMAGE[answers.damage])
  add(ROOF_AGE[answers.roofAge])
  add(INSURANCE[answers.insurance])
  add(CLAIM[answers.claim])
  if (answers.slotChosen) add([10, 'Picked an inspection time'])
  if (answers.decisionMakersPresent) add([5, 'All decision-makers will be there'])

  const bounded = Math.max(0, Math.min(100, score))
  const tier: HeatTier = bounded >= HOT_THRESHOLD ? 'hot' : bounded >= WARM_THRESHOLD ? 'warm' : 'cool'
  return { score: bounded, tier, reasons }
}

/** Type guards for untrusted form input; the edge function rejects anything else. */
export const DAMAGE_VALUES: readonly DamageAnswer[] = ['leak', 'visible', 'unsure', 'none']
export const ROOF_AGE_VALUES: readonly RoofAgeAnswer[] = ['under5', '5to10', '10to15', 'over15', 'unknown']
export const INSURANCE_VALUES: readonly InsuranceAnswer[] = ['yes', 'no', 'unsure']
export const CLAIM_VALUES: readonly ClaimAnswer[] = ['filed', 'want_documentation', 'not_yet']

export function oneOf<T extends string>(values: readonly T[], input: unknown): T | null {
  return typeof input === 'string' && (values as readonly string[]).includes(input) ? (input as T) : null
}

/**
 * Short, stable code printed on a mailer and carried on the QR link, so a
 * response can be tied back to the exact property that was mailed.
 */
export function mailerRefCode(propertyId: string): string {
  return propertyId.replace(/-/g, '').slice(0, 10).toUpperCase()
}
