import { MIN_DECIDED_PER_REP } from './metrics'
import type { Rate, RepPerformance, TeamRate } from './performance'

/**
 * Turning a rep's window into a grade, and showing all of the working.
 *
 * Three things about this file are worth stating before the code, because they
 * are decisions rather than implementation.
 *
 * **It is arithmetic, and it is labelled as arithmetic.** The grade below is
 * produced by a weighted rubric with published weights and published
 * thresholds, not by a language model. Calling that "AI" on the screen would be
 * a small lie that makes the number harder to argue with, which is the opposite
 * of what a grade about somebody's work should be. `engine` carries
 * `rubric@1` and the UI says so. A model may later be asked to write the
 * narrative around these figures; when that happens it gets its own engine
 * string and the figures stay computed here.
 *
 * **Everything is relative to this team.** There is no industry benchmark
 * anywhere, because one would be a claim about Delta Ridge that Delta Ridge's
 * own numbers had not made. A rep is measured against what their colleagues
 * convert, on doors of the same frozen score.
 *
 * **A missing category is dropped, never guessed.** If a rep has eleven
 * inspections and the floor is eight, that category scores. If they have three,
 * it does not, its weight is removed from the denominator, and the confidence
 * falls by exactly the weight that was removed. A grade computed from half the
 * rubric says so on its face.
 */

export type GradingMode = 'manual' | 'assisted' | 'automatic'

export type CategoryKey =
  | 'field_effort'
  | 'door_productivity'
  | 'contact_conversion'
  | 'appointment_conversion'
  | 'inspection_conversion'
  | 'contract_conversion'
  | 'follow_up'
  | 'lead_utilisation'

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  field_effort: 'Field effort',
  door_productivity: 'Door productivity',
  contact_conversion: 'Contact conversion',
  appointment_conversion: 'Appointment conversion',
  inspection_conversion: 'Inspection conversion',
  contract_conversion: 'Contract conversion',
  follow_up: 'Follow-up',
  lead_utilisation: 'Lead utilisation',
}

/**
 * What this engine refuses to grade on, written down so it cannot quietly
 * creep back in.
 *
 * Every one of these rewards something other than selling roofs: miles driven
 * rewards living far away, time with the app open rewards leaving it open, raw
 * fix count rewards a phone with a better antenna, and leads received rewards
 * whoever the manager already favours. They appear in this system as context a
 * human can read, and never as a term in the score.
 */
export const NEVER_GRADED_ON = [
  'miles driven',
  'time the app was open',
  'raw GPS sample count',
  'how long the route timer ran',
  'how many leads the rep was given',
] as const

export type Weights = Record<CategoryKey, number>

/**
 * The default split. Hand-set, published, and editable by the manager — there
 * is no learned weighting here and there is not enough outcome history in this
 * system to justify pretending otherwise.
 */
export const DEFAULT_WEIGHTS: Weights = {
  field_effort: 20,
  door_productivity: 15,
  contact_conversion: 15,
  appointment_conversion: 15,
  inspection_conversion: 10,
  contract_conversion: 10,
  follow_up: 10,
  lead_utilisation: 5,
}

export interface GradeStep {
  letter: string
  /** Lowest score that earns this letter. */
  atLeast: number
}

/**
 * The scale, centred so that matching the team is a B.
 *
 * A rep who does exactly what their colleagues do is doing the job. A scale
 * where the team average lands on a C is a scale that tells most of a
 * functioning team they are below par, which is both untrue and the fastest way
 * to get every grade ignored.
 */
export const DEFAULT_SCALE: GradeStep[] = [
  { letter: 'A+', atLeast: 95 },
  { letter: 'A', atLeast: 88 },
  { letter: 'A-', atLeast: 82 },
  { letter: 'B+', atLeast: 76 },
  { letter: 'B', atLeast: 68 },
  { letter: 'B-', atLeast: 62 },
  { letter: 'C+', atLeast: 56 },
  { letter: 'C', atLeast: 50 },
  { letter: 'C-', atLeast: 44 },
  { letter: 'D', atLeast: 35 },
  { letter: 'Needs improvement', atLeast: 0 },
]

export interface GradingConfig {
  mode: GradingMode
  weights: Weights
  scale: GradeStep[]
  /**
   * Below this, the engine still produces a grade but marks it as not fit to
   * stand on its own. The screen refuses to show it as a headline.
   *
   * 0.6 by default, which with complete data means roughly two thirds of the
   * rubric could be scored. A grade built on half the categories is a grade
   * about half of somebody's job, and the number that gets quoted from it will
   * not carry the asterisk.
   */
  minConfidence: number
  /** Whether a manager must sign off before a grade counts as the rep's grade. */
  managerApprovalRequired: boolean
}

export const DEFAULT_CONFIG: GradingConfig = {
  // Assisted, deliberately. Automatic hands one rubric quiet control over who
  // gets the best doors; manual throws away the only thing a computer is
  // actually better at here, which is reading four thousand activity rows
  // without getting bored.
  mode: 'assisted',
  weights: DEFAULT_WEIGHTS,
  scale: DEFAULT_SCALE,
  minConfidence: 0.6,
  managerApprovalRequired: true,
}

// ---------------------------------------------------------------------------
// Scoring one category
// ---------------------------------------------------------------------------

/**
 * A rep's rate against the team's, on a 0–100 scale where the team rate is 70.
 *
 * Piecewise on purpose. Above the team rate, doing twice as well as everybody
 * else is the top of the scale and there is nothing above it — a rep who
 * converts at five times the team rate has a sample problem, not an A++.
 * Below it, the score falls in proportion, so half the team rate is half of 70.
 */
export function relativeScore(repRate: number, teamRate: number): number {
  if (teamRate <= 0) return 70
  const ratio = repRate / teamRate
  if (ratio >= 1) return Math.min(100, 70 + 30 * Math.min(ratio - 1, 1))
  return Math.max(0, 70 * ratio)
}

export interface CategoryScore {
  key: CategoryKey
  label: string
  /** Null when there was not enough to say. Its weight is then removed. */
  score: number | null
  weight: number
  /** What the rep did, in the metric's own units. */
  repValue: number | null
  teamValue: number | null
  /** The sample the rep's figure rests on. */
  sample: number
  /** The floor that sample had to clear, so a caller can see how close it was. */
  floor: number
  unavailable: string | null
  /** One line, with the numbers in it, for the explanation. */
  evidence: string
}

export interface TeamContext {
  contactRate: TeamRate
  appointmentRate: TeamRate
  inspectionRate: TeamRate
  contractRate: TeamRate
  followUpRate: TeamRate
  knocksPerHour: TeamRate
  verifiedPerHour: TeamRate
  routeCompletion: TeamRate
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function compare(
  key: CategoryKey,
  weight: number,
  repRate: Rate,
  team: TeamRate,
  unit: 'percent' | 'perHour' | 'index',
): CategoryScore {
  const label = CATEGORY_LABEL[key]
  const base = {
    key,
    label,
    weight,
    repValue: repRate.value,
    teamValue: team.value,
    sample: repRate.denominator,
    floor: repRate.minimum,
  }

  if (repRate.value === null) {
    return { ...base, score: null, unavailable: repRate.unavailable, evidence: `${label}: ${repRate.unavailable ?? 'not enough data.'}` }
  }
  if (team.value === null) {
    return {
      ...base,
      score: null,
      unavailable: team.unavailable,
      evidence: `${label}: ${team.unavailable ?? 'the team has no rate to compare against yet.'}`,
    }
  }

  const format = (v: number) =>
    unit === 'percent' ? pct(v) : unit === 'perHour' ? `${v.toFixed(1)}/h` : v.toFixed(2)

  return {
    ...base,
    score: relativeScore(repRate.value, team.value),
    unavailable: null,
    evidence: `${label}: ${format(repRate.value)} against the team's ${format(team.value)}, from ${repRate.denominator} ${unit === 'percent' ? 'in the denominator' : 'hours'}.`,
  }
}

// ---------------------------------------------------------------------------
// The grade
// ---------------------------------------------------------------------------

export interface ComputedGrade {
  /** What produced this. Stored with the grade so an old one can be read back. */
  engine: string
  score: number | null
  letter: string | null
  confidence: number
  categories: CategoryScore[]
  weightsUsed: Weights
  scaleUsed: GradeStep[]
  /** Share of the rubric that could actually be scored, 0–1. */
  coverage: number
  strengths: string[]
  weaknesses: string[]
  coaching: string[]
  /** Everything the confidence figure was built from. */
  confidenceFrom: { dataCompleteness: number; coverage: number; sampleAdequacy: number }
  /** Why there is no grade, when there is none. */
  unavailable: string | null
  /** Said plainly wherever the grade is shown. */
  lowConfidence: boolean
}

export const ENGINE = 'rubric@1'

export function letterFor(score: number, scale: readonly GradeStep[]): string {
  const ordered = [...scale].sort((a, b) => b.atLeast - a.atLeast)
  for (const step of ordered) if (score >= step.atLeast) return step.letter
  return (ordered[ordered.length - 1] as GradeStep).letter
}

/** How well-supported a scored category is: at the floor is 0.5, twice it is 1. */
function adequacy(sample: number, floor: number): number {
  if (floor <= 0) return 1
  return Math.max(0, Math.min(1, sample / (floor * 2)))
}

export function gradeRep(
  performance: RepPerformance,
  team: TeamContext,
  config: GradingConfig = DEFAULT_CONFIG,
): ComputedGrade {
  const w = config.weights

  // Field effort is route completion, NOT hours or miles. A rep who works the
  // doors they were given has done the job; a rep who drove further has not.
  const routeCompletion: Rate =
    performance.doors.assigned > 0
      ? {
          value: performance.doors.knocked / performance.doors.assigned,
          numerator: performance.doors.knocked,
          denominator: performance.doors.assigned,
          minimum: 1,
          unavailable: null,
        }
      : {
          value: null,
          numerator: 0,
          denominator: 0,
          minimum: 1,
          unavailable: 'No doors were assigned in this window, so there is no route to have completed.',
        }

  const verifiedPerHour: Rate = {
    value: performance.field.knocksPerFieldHour.denominator > 0
      ? performance.field.verifiedKnocks / performance.field.knocksPerFieldHour.denominator
      : null,
    numerator: performance.field.verifiedKnocks,
    denominator: performance.field.knocksPerFieldHour.denominator,
    minimum: performance.field.knocksPerFieldHour.minimum,
    unavailable:
      performance.field.knocksPerFieldHour.denominator > 0
        ? null
        : 'No completed routes in this window, so there are no field hours to divide by.',
  }

  // Lead utilisation is the efficiency index, which is the only figure in the
  // system that already holds lead quality constant. Expressed against 1.0.
  const efficiency = performance.quality.efficiency
  const utilisation: Rate =
    efficiency.index === null
      ? {
          value: null,
          numerator: efficiency.won,
          denominator: efficiency.decided,
          minimum: MIN_DECIDED_PER_REP,
          unavailable: efficiency.unavailable,
        }
      : {
          value: efficiency.index,
          numerator: efficiency.won,
          denominator: efficiency.decided,
          minimum: MIN_DECIDED_PER_REP,
          unavailable: null,
        }

  const categories: CategoryScore[] = [
    compare('field_effort', w.field_effort, routeCompletion, team.routeCompletion, 'percent'),
    compare('door_productivity', w.door_productivity, verifiedPerHour, team.verifiedPerHour, 'perHour'),
    compare('contact_conversion', w.contact_conversion, performance.doors.contactRate, team.contactRate, 'percent'),
    compare('appointment_conversion', w.appointment_conversion, performance.doors.appointmentRate, team.appointmentRate, 'percent'),
    compare('inspection_conversion', w.inspection_conversion, performance.sales.inspectionRate, team.inspectionRate, 'percent'),
    compare('contract_conversion', w.contract_conversion, performance.sales.contractRate, team.contractRate, 'percent'),
    compare('follow_up', w.follow_up, performance.followUp.completionRate, team.followUpRate, 'percent'),
    compare('lead_utilisation', w.lead_utilisation, utilisation, { value: 1, reps: 0, unavailable: null }, 'index'),
  ]

  const scored = categories.filter((c) => c.score !== null)
  const totalWeight = categories.reduce((t, c) => t + c.weight, 0)
  const scoredWeight = scored.reduce((t, c) => t + c.weight, 0)
  const coverage = totalWeight > 0 ? scoredWeight / totalWeight : 0

  // A category sitting exactly on its floor is worth half of one sitting at
  // twice it. Without this, eight inspections and eighty inspections would
  // produce the same confidence, and the first is a coin toss.
  const sampleAdequacy =
    scored.length > 0
      ? scored.reduce((t, c) => t + adequacy(c.sample, c.floor), 0) / scored.length
      : 0

  const confidenceFrom = {
    dataCompleteness: performance.completeness.score,
    coverage,
    sampleAdequacy,
  }
  const confidence = performance.completeness.score * coverage * (0.5 + 0.5 * sampleAdequacy)

  if (scored.length === 0 || scoredWeight === 0) {
    return {
      engine: ENGINE,
      score: null,
      letter: null,
      confidence: 0,
      categories,
      weightsUsed: w,
      scaleUsed: config.scale,
      coverage: 0,
      strengths: [],
      weaknesses: [],
      coaching: [],
      confidenceFrom,
      unavailable:
        'Nothing in the rubric could be scored for this window. Every category is either below its sample floor or has no team rate to compare against.',
      lowConfidence: true,
    }
  }

  const score = scored.reduce((t, c) => t + (c.score as number) * c.weight, 0) / scoredWeight
  const letter = letterFor(score, config.scale)

  const ranked = [...scored].sort((a, b) => (b.score as number) - (a.score as number))
  const strengths = ranked.filter((c) => (c.score as number) >= 78).slice(0, 3).map((c) => `+ ${c.evidence}`)
  const weakest = [...ranked].reverse().filter((c) => (c.score as number) < 62)
  const weaknesses = weakest.slice(0, 3).map((c) => `− ${c.evidence}`)

  return {
    engine: ENGINE,
    score,
    letter,
    confidence,
    categories,
    weightsUsed: w,
    scaleUsed: config.scale,
    coverage,
    strengths,
    weaknesses,
    coaching: coachingFor(weakest.map((c) => c.key), performance),
    confidenceFrom,
    unavailable: null,
    lowConfidence: confidence < config.minConfidence,
  }
}

/**
 * What to actually do about it.
 *
 * Tied to the category that scored lowest and phrased as something a manager
 * can say on Monday. No generic encouragement: "keep up the good work" is what
 * a review says when nobody read the numbers.
 */
export function coachingFor(
  weak: readonly CategoryKey[],
  performance: RepPerformance,
): string[] {
  const out: string[] = []
  for (const key of weak.slice(0, 3)) {
    switch (key) {
      case 'field_effort':
        out.push(
          `${performance.doors.assigned - performance.doors.knocked} assigned doors were never knocked. Worth finding out whether the list was wrong or the day was.`,
        )
        break
      case 'door_productivity':
        out.push(
          'Verified doors per field hour is low. Check whether outcomes are being entered at the door or from the truck afterwards — the second one looks identical to not knocking.',
        )
        break
      case 'contact_conversion':
        out.push(
          'Few doors are being answered. Usually a timing problem rather than a rep one: try the same streets after 5pm before changing anything else.',
        )
        break
      case 'appointment_conversion':
        out.push(
          'Conversations are happening but not turning into appointments. Sit in on three doors and listen for the ask.',
        )
        break
      case 'inspection_conversion':
        out.push(
          'Appointments are being booked but not held. Confirm the morning of, and look at how far out they are being set.',
        )
        break
      case 'contract_conversion':
        out.push(
          'Inspections are not closing. Review the estimate follow-up — specifically how long after the inspection the homeowner hears a number.',
        )
        break
      case 'follow_up':
        out.push(
          `${performance.followUp.overdue} follow-ups the rep set themselves have come and gone. This is the cheapest thing on this list to fix.`,
        )
        break
      case 'lead_utilisation':
        out.push(
          'Converting below what doors of this quality convert for the rest of the team. Worth pairing them with whoever is above the line on the same score band.',
        )
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// What gets stored
// ---------------------------------------------------------------------------

/**
 * A grade as it is filed: the computed one and the manager's, side by side and
 * never merged.
 *
 * The two are separate columns rather than one field with a provenance flag,
 * because the question a year from now is "did the manager agree with the
 * rubric" and that question is unanswerable if accepting a grade overwrites it.
 * An override keeps both and records a reason.
 */
export interface StoredGrade {
  repId: string
  periodStart: string
  periodEnd: string
  period: 'daily' | 'weekly' | 'monthly'
  mode: GradingMode
  computed: ComputedGrade | null
  managerLetter: string | null
  managerComment: string | null
  managerOverrideReason: string | null
  managerCategoryScores: Partial<Record<CategoryKey, number>> | null
  gradedBy: string | null
  gradedAt: string | null
}

/**
 * The grade that counts, and where it came from.
 *
 * In every mode the manager's word wins when there is one. In `automatic` the
 * computed grade stands in until they say otherwise; in `manual` it is never
 * the rep's grade at all, however confident it is.
 */
export function effectiveGrade(
  grade: StoredGrade,
  config: GradingConfig,
): { letter: string | null; source: 'manager' | 'computed' | 'none'; note: string } {
  if (grade.managerLetter) {
    return {
      letter: grade.managerLetter,
      source: 'manager',
      note: grade.managerOverrideReason
        ? 'Set by the manager, overriding the computed grade.'
        : 'Set by the manager.',
    }
  }
  if (config.mode === 'manual') {
    return { letter: null, source: 'none', note: 'Grading is set to manual. No grade until the manager enters one.' }
  }
  if (config.mode === 'assisted' || config.managerApprovalRequired) {
    return {
      letter: null,
      source: 'none',
      note: 'The computed grade is a suggestion. It is not this rep’s grade until a manager accepts or changes it.',
    }
  }
  if (!grade.computed?.letter) {
    return { letter: null, source: 'none', note: 'There was not enough data to compute a grade for this period.' }
  }
  return {
    letter: grade.computed.letter,
    source: 'computed',
    note: grade.computed.lowConfidence
      ? 'Computed automatically, and flagged as low confidence — worth a look before it is used for anything.'
      : 'Computed automatically. A manager can change it at any time.',
  }
}
