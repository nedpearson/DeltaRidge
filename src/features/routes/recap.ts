import {
  asDoorOutcome,
  isConversation,
  type DoorOutcome,
} from '@/features/leads/pipeline'
import type { DoorEvent } from './route-stats'

/**
 * What a route actually produced, broken out the way a rep reads it.
 *
 * Two things live here and they answer different questions. The outcome
 * breakdown says what was recorded at each door. The funnel says how many doors
 * survived each step toward a sale. Both are built from the same events, and
 * neither invents a step it cannot see.
 *
 * The rule that shapes this whole file: a stage nobody could measure is NOT
 * reported as zero. "0 proposals sent" and "proposals are not counted on this
 * screen" look identical on a dashboard and mean completely different things -
 * the first says a rep had a bad day, the second says the software does not
 * know. Reporting the second as the first is how a manager ends up coaching
 * somebody for a number that was never being collected.
 */

// ---------------------------------------------------------------------------
// What was recorded at each door
// ---------------------------------------------------------------------------

/**
 * Every outcome the build understands, in the order a rep would read them:
 * worked down from "nobody came" to "they bought".
 *
 * Listed explicitly rather than taken from Object.keys(RULES) so the screen
 * order is a decision rather than an accident of how the rules were typed.
 */
export const OUTCOME_ORDER: readonly DoorOutcome[] = [
  'no_answer',
  'left_info',
  'spoke',
  'come_back',
  'interested',
  'wants_inspection',
  'appointment_set',
  'inspect_now',
  'not_interested',
  'renter',
  'roof_replaced',
  'vacant',
  'do_not_knock',
  'other',
]

export const OUTCOME_LABEL: Record<DoorOutcome, string> = {
  no_answer: 'No answer',
  left_info: 'Left info',
  spoke: 'Spoke with homeowner',
  come_back: 'Come back',
  interested: 'Interested',
  wants_inspection: 'Wants inspection',
  appointment_set: 'Appointment set',
  inspect_now: 'Inspected on the spot',
  not_interested: 'Not interested',
  renter: 'Renter',
  roof_replaced: 'Roof already replaced',
  vacant: 'Vacant',
  do_not_knock: 'Do not knock',
  other: 'Other',
}

export interface OutcomeCount {
  readonly outcome: DoorOutcome
  readonly label: string
  readonly count: number
}

/**
 * Activity types that mean a rep recorded an outcome standing at a door.
 *
 * `appointment_set` and `appointment` are in here for a reason that is easy to
 * miss: RoutePanel maps an appointment-set knock's kind to `'appointment'`
 * before it reaches this module. Matching only `'door_knock'` therefore drops
 * the single best door of the day out of the funnel and the breakdown - the
 * one where somebody booked. It was doing exactly that until a test asked.
 *
 * Calls, texts and notes are deliberately not here. They are contact, but
 * nobody stood at a door for them, and counting them would inflate the door
 * count with work done from a truck.
 */
const DOOR_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'door_knock',
  'appointment_set',
  'appointment',
])

function isDoorInteraction(activityType: string): boolean {
  return DOOR_ACTIVITY_TYPES.has(activityType)
}

/**
 * Counts every door interaction by the outcome the rep chose.
 *
 * An outcome this build does not recognise is dropped rather than coerced -
 * `asDoorOutcome` exists for exactly that, so a word from an older client
 * cannot sit in the breakdown looking like a real category.
 *
 * Zero rows are returned too, by default, because the shape of a day is in what
 * did NOT happen as much as what did. `nonZero` trims it for a small screen.
 */
export function outcomeBreakdown(
  events: readonly DoorEvent[],
  options: { nonZero?: boolean } = {},
): OutcomeCount[] {
  const counts = new Map<DoorOutcome, number>()
  for (const outcome of OUTCOME_ORDER) counts.set(outcome, 0)

  for (const event of events) {
    if (!isDoorInteraction(event.activityType)) continue
    const outcome = asDoorOutcome(event.outcome)
    if (!outcome) continue
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1)
  }

  const rows = OUTCOME_ORDER.map((outcome) => ({
    outcome,
    label: OUTCOME_LABEL[outcome],
    count: counts.get(outcome) ?? 0,
  }))

  return options.nonZero ? rows.filter((r) => r.count > 0) : rows
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

/**
 * Stages the door events themselves can prove.
 *
 * Everything past `inspections` needs a source this module is not given: a
 * completed inspection lives in the inspections table with a completed_at, an
 * estimate and a proposal live in estimates, and a sale is a lead status. Those
 * are passed in when the caller has them and OMITTED when it does not - see
 * `unmeasured` on RouteFunnel.
 */
export type FunnelStageKey =
  | 'doors'
  | 'conversations'
  | 'interested'
  | 'appointments'
  | 'inspections'
  | 'estimates'
  | 'proposals'
  | 'sales'

export const FUNNEL_LABEL: Record<FunnelStageKey, string> = {
  doors: 'Doors',
  conversations: 'Conversations',
  interested: 'Interested',
  appointments: 'Appointments',
  inspections: 'Inspections',
  estimates: 'Estimates',
  proposals: 'Proposals',
  sales: 'Sales',
}

export interface FunnelStage {
  readonly key: FunnelStageKey
  readonly label: string
  readonly count: number
  /**
   * Share of the previous MEASURED stage that reached this one.
   *
   * Null when the stage above it was zero. A rate needs a denominator, and
   * 0 of 0 is not 0% - it is a question nobody asked. Rendering it as 0% tells
   * a rep they converted nothing when in fact nothing arrived to convert.
   */
  readonly rate: number | null
}

export interface RouteFunnel {
  readonly stages: readonly FunnelStage[]
  /**
   * Stages left out because this route had no way to measure them, named so
   * their absence is visible on screen instead of reading as a row of zeros.
   */
  readonly unmeasured: readonly FunnelStageKey[]
}

/**
 * Counts the caller can supply from outside the door events.
 *
 * Every field is optional and `undefined` means "not measured", which is NOT
 * the same as 0. A caller that knows there were no sales passes 0; a caller
 * with no access to sales passes nothing, and the stage is dropped.
 */
export interface OutcomeSources {
  readonly inspectionsCompleted?: number
  readonly estimatesCreated?: number
  readonly proposalsSent?: number
  readonly sales?: number
}

function rateOf(count: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null
  return count / previous
}

/**
 * Builds the route's funnel from doors down to whatever the caller can prove.
 *
 * `interested` deliberately counts only `interested` and `wants_inspection` -
 * the two outcomes where a homeowner said they wanted something. A conversation
 * that ended in "not interested" is a conversation and not an interest, and
 * folding the two together would make the one rate a manager actually watches
 * meaningless.
 *
 * `inspections` counts inspections STARTED at the door (`inspect_now`), which
 * is what a door event can witness. Completed inspections are a different
 * number and arrive through OutcomeSources.
 */
export function buildFunnel(
  events: readonly DoorEvent[],
  sources: OutcomeSources = {},
): RouteFunnel {
  const knocked = new Set<string>()
  let conversations = 0
  let interested = 0
  let appointments = 0
  let inspections = 0

  for (const event of events) {
    if (event.activityType === 'appointment' || event.activityType === 'appointment_set') {
      appointments += 1
    }
    if (!isDoorInteraction(event.activityType)) continue

    // A door, not a knock. Three knocks at one address is one door through the
    // funnel, or a rep who knocks twice looks twice as productive.
    knocked.add(event.leadId)

    const outcome = asDoorOutcome(event.outcome)
    if (!outcome) continue
    if (isConversation(outcome)) conversations += 1
    if (outcome === 'interested' || outcome === 'wants_inspection') interested += 1
    if (outcome === 'inspect_now') inspections += 1
  }

  const measured: { key: FunnelStageKey; count: number }[] = [
    { key: 'doors', count: knocked.size },
    { key: 'conversations', count: conversations },
    { key: 'interested', count: interested },
    { key: 'appointments', count: appointments },
    {
      key: 'inspections',
      // A completed inspection supersedes the started count when the caller
      // knows it; otherwise what happened at the door is the best evidence.
      count: sources.inspectionsCompleted ?? inspections,
    },
  ]

  const unmeasured: FunnelStageKey[] = []
  for (const [key, value] of [
    ['estimates', sources.estimatesCreated],
    ['proposals', sources.proposalsSent],
    ['sales', sources.sales],
  ] as const) {
    if (value === undefined) unmeasured.push(key)
    else measured.push({ key, count: value })
  }

  const stages: FunnelStage[] = []
  let previous: number | null = null
  for (const stage of measured) {
    stages.push({
      key: stage.key,
      label: FUNNEL_LABEL[stage.key],
      count: stage.count,
      rate: rateOf(stage.count, previous),
    })
    previous = stage.count
  }

  return { stages, unmeasured }
}

/** A rate as a whole-number percentage, or an em dash where there is none. */
export function rateLabel(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}
