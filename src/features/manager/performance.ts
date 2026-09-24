import { asDoorOutcome, isConversation } from '@/features/leads/pipeline'
import {
  bandOf,
  efficiencyFor,
  isDecided,
  isWon,
  type ActivityRow,
  type AssignmentOutcome,
  type BandRate,
  type EfficiencyResult,
  type RouteRow,
} from './metrics'

/**
 * A rep's whole record for a window, with every rate carrying its own refusal.
 *
 * The shape here is deliberate: there is no bare `number` anywhere that a
 * screen could print without deciding what to do about a small sample. Every
 * rate is a `Rate`, a rate is either a figure with its numerator and
 * denominator or a stated reason there is none, and a caller cannot get at the
 * figure without walking past the reason.
 *
 * That is not defensive programming for its own sake. The alternative — a
 * `contactRate` that is 1.0 because one door out of one was answered — is the
 * number that gets quoted in a conversation about somebody's job, and by the
 * time anyone checks the denominator the conversation has already happened.
 */

export interface Rate {
  /** Null when the sample is too thin to report. */
  value: number | null
  numerator: number
  denominator: number
  /** The floor this rate had to clear. Carried so downstream can weigh it. */
  minimum: number
  /** Why there is no value, in words shown to the manager verbatim. */
  unavailable: string | null
}

export function rate(numerator: number, denominator: number, minimum: number, what: string): Rate {
  if (denominator < minimum) {
    return {
      value: null,
      numerator,
      denominator,
      minimum,
      unavailable: `${denominator} ${what} so far. This needs at least ${minimum} before the rate means anything.`,
    }
  }
  return { value: numerator / denominator, numerator, denominator, minimum, unavailable: null }
}

/**
 * Sample floors, gathered in one place so they can be argued with as a set.
 *
 * These are judgement calls, not statistics. They were chosen to be the point
 * at which one lucky or unlucky door stops moving the figure by more than a
 * few points — not by a power calculation, because nobody has the variance
 * data for door knocking that such a calculation would need. They are
 * configurable for exactly that reason.
 */
export interface SampleFloors {
  knocksForContactRate: number
  conversationsForAppointmentRate: number
  appointmentsForInspectionRate: number
  inspectionsForContractRate: number
  followUpsForCompletion: number
  routesForFieldRates: number
}

export const DEFAULT_FLOORS: SampleFloors = {
  knocksForContactRate: 40,
  conversationsForAppointmentRate: 15,
  appointmentsForInspectionRate: 10,
  inspectionsForContractRate: 8,
  followUpsForCompletion: 10,
  routesForFieldRates: 3,
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One assigned door, with everything frozen that needs to be. */
export interface AssignedLead {
  repId: string
  leadClientId: string
  scoreAtAssignment: number
  assignedAt: string
  status: string
  /** When the rep said they would come back. Null if never set. */
  nextActionAt: string | null
  lastActivityAt: string | null
  subdivision: string | null
}

export interface PerformanceInput {
  repId: string
  from: string
  to: string
  activity: readonly ActivityRow[]
  routes: readonly RouteRow[]
  assignments: readonly AssignedLead[]
  baseline: readonly BandRate[]
  floors?: SampleFloors
  now?: number
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface FieldActivity {
  routesStarted: number
  routesCompleted: number
  /** Start to stop, summed. Wall clock, not "time working". */
  fieldSeconds: number
  /** Routes with no fixes at all. Counted, because they make the rest thinner. */
  routesWithoutFixes: number
  fixes: number
  knocks: number
  doors: number
  verifiedKnocks: number
  knocksPerFieldHour: Rate
}

export interface DoorResults {
  assigned: number
  knocked: number
  conversations: number
  contactRate: Rate
  appointments: number
  appointmentRate: Rate
}

export interface SalesResults {
  inspections: number
  inspectionRate: Rate
  contracts: number
  contractRate: Rate
}

export interface FollowUp {
  due: number
  completed: number
  overdue: number
  completionRate: Rate
}

export interface LeadQuality {
  assigned: number
  averageScore: number | null
  /** Doors by band, so "they were given the good streets" is checkable. */
  byBand: { band: number; count: number }[]
  efficiency: EfficiencyResult
}

export interface RepPerformance {
  repId: string
  from: string
  to: string
  field: FieldActivity
  doors: DoorResults
  sales: SalesResults
  followUp: FollowUp
  quality: LeadQuality
  /** What was missing, for whoever has to decide how much of this to believe. */
  completeness: DataCompleteness
}

export interface DataCompleteness {
  /** Door events with no GPS verdict of any kind. */
  knocksWithoutGps: number
  /** Door events with no recognised outcome. */
  knocksWithoutOutcome: number
  /** Assigned doors with no frozen score. Should be zero; the column is NOT NULL. */
  assignmentsWithoutScore: number
  routesWithoutFixes: number
  /** 0–1. How much of what should be there is. */
  score: number
  notes: string[]
}

// ---------------------------------------------------------------------------

const INSPECTED_STATUSES = new Set(['inspected', 'proposal_pending', 'sold'])

function withinWindow(at: string, from: string, to: string): boolean {
  return at >= from && at <= to
}

export function performanceFor(input: PerformanceInput): RepPerformance {
  const floors = input.floors ?? DEFAULT_FLOORS
  const now = input.now ?? Date.now()

  const mine = input.activity.filter(
    (a) => a.userId === input.repId && withinWindow(a.occurredAt, input.from, input.to),
  )
  const knockRows = mine.filter((a) => a.activityType === 'door_knock')
  const myRoutes = input.routes.filter(
    (r) => r.userId === input.repId && withinWindow(r.startedAt, input.from, input.to),
  )
  const myLeads = input.assignments.filter((a) => a.repId === input.repId)

  // --- Field ---------------------------------------------------------------
  const completed = myRoutes.filter((r) => r.endedAt)
  const fieldSeconds = completed.reduce((total, r) => {
    const start = Date.parse(r.startedAt)
    const end = Date.parse(r.endedAt as string)
    return Number.isFinite(start) && end > start ? total + (end - start) / 1000 : total
  }, 0)
  const routesWithoutFixes = myRoutes.filter((r) => r.pointCount === 0).length

  const doorsTouched = new Set(knockRows.map((a) => a.leadClientId))
  const verifiedKnocks = knockRows.filter((a) => a.gpsVerification === 'verified').length

  const field: FieldActivity = {
    routesStarted: myRoutes.length,
    routesCompleted: completed.length,
    fieldSeconds,
    routesWithoutFixes,
    fixes: myRoutes.reduce((total, r) => total + r.pointCount, 0),
    knocks: knockRows.length,
    doors: doorsTouched.size,
    verifiedKnocks,
    knocksPerFieldHour: rate(
      knockRows.length,
      Math.round(fieldSeconds / 3600),
      floors.routesForFieldRates,
      'completed field hours',
    ),
  }

  // --- Doors ---------------------------------------------------------------
  const conversations = knockRows.filter((a) => {
    const outcome = asDoorOutcome(a.outcome)
    return outcome !== null && isConversation(outcome)
  }).length
  const appointments = mine.filter(
    (a) => a.activityType === 'appointment' || a.activityType === 'appointment_set',
  ).length

  const doors: DoorResults = {
    assigned: myLeads.length,
    knocked: doorsTouched.size,
    conversations,
    contactRate: rate(conversations, knockRows.length, floors.knocksForContactRate, 'knocks'),
    appointments,
    // Against conversations, not against knocks. Booking from a door nobody
    // answered is not a thing, and dividing by knocks would make a rep who
    // works empty streets look like a poor closer.
    appointmentRate: rate(
      appointments,
      conversations,
      floors.conversationsForAppointmentRate,
      'conversations',
    ),
  }

  // --- Sales ---------------------------------------------------------------
  const inspections = myLeads.filter((l) => INSPECTED_STATUSES.has(l.status)).length
  const contracts = myLeads.filter((l) => isWon(l.status)).length

  const sales: SalesResults = {
    inspections,
    inspectionRate: rate(
      inspections,
      appointments,
      floors.appointmentsForInspectionRate,
      'appointments',
    ),
    contracts,
    contractRate: rate(contracts, inspections, floors.inspectionsForContractRate, 'inspections'),
  }

  // --- Follow-up -----------------------------------------------------------
  // A follow-up is due when the rep themselves said they would come back by a
  // date that has passed. It is completed when something was recorded against
  // that lead afterwards. Nothing here judges the QUALITY of the follow-up,
  // only whether one happened, because the app cannot see a phone call.
  let due = 0
  let doneOnTime = 0
  for (const lead of myLeads) {
    if (!lead.nextActionAt) continue
    const dueAt = Date.parse(lead.nextActionAt)
    if (!Number.isFinite(dueAt) || dueAt > now) continue
    due += 1
    const last = lead.lastActivityAt ? Date.parse(lead.lastActivityAt) : NaN
    if (Number.isFinite(last) && last >= dueAt) doneOnTime += 1
  }

  const followUp: FollowUp = {
    due,
    completed: doneOnTime,
    overdue: due - doneOnTime,
    completionRate: rate(doneOnTime, due, floors.followUpsForCompletion, 'follow-ups that came due'),
  }

  // --- Lead quality --------------------------------------------------------
  const scores = myLeads.map((l) => l.scoreAtAssignment).filter((s) => Number.isFinite(s))
  const bandCounts = new Map<number, number>()
  for (const score of scores) bandCounts.set(bandOf(score), (bandCounts.get(bandOf(score)) ?? 0) + 1)

  const outcomes: AssignmentOutcome[] = input.assignments.map((a) => ({
    repId: a.repId,
    scoreAtAssignment: a.scoreAtAssignment,
    status: a.status,
  }))

  const quality: LeadQuality = {
    assigned: myLeads.length,
    averageScore: scores.length > 0 ? scores.reduce((t, s) => t + s, 0) / scores.length : null,
    byBand: [...bandCounts.entries()]
      .map(([band, count]) => ({ band, count }))
      .sort((a, b) => a.band - b.band),
    efficiency: efficiencyFor(input.repId, outcomes, input.baseline),
  }

  // --- Completeness --------------------------------------------------------
  const knocksWithoutGps = knockRows.filter((a) => !a.gpsVerification).length
  const knocksWithoutOutcome = knockRows.filter((a) => asDoorOutcome(a.outcome) === null).length
  const assignmentsWithoutScore = myLeads.filter((l) => !Number.isFinite(l.scoreAtAssignment)).length

  const notes: string[] = []
  if (knockRows.length > 0 && knocksWithoutGps / knockRows.length > 0.2) {
    notes.push(
      `${knocksWithoutGps} of ${knockRows.length} door events have no GPS verdict, so the verified counts understate the work.`,
    )
  }
  if (knocksWithoutOutcome > 0) {
    notes.push(`${knocksWithoutOutcome} door events have no outcome this build recognises.`)
  }
  if (routesWithoutFixes > 0) {
    notes.push(
      `${routesWithoutFixes} route${routesWithoutFixes === 1 ? '' : 's'} recorded no GPS at all, so field time is start-to-stop only.`,
    )
  }
  if (myRoutes.length > completed.length) {
    notes.push(`${myRoutes.length - completed.length} route(s) were never ended, so their hours are not counted.`)
  }

  // Deliberately blunt: each failing category takes a fixed bite rather than
  // being weighted by importance, because an importance weight here would be a
  // second set of judgement calls hiding inside a completeness score.
  const penalties = [
    knockRows.length > 0 ? knocksWithoutGps / knockRows.length : 0,
    knockRows.length > 0 ? knocksWithoutOutcome / knockRows.length : 0,
    myRoutes.length > 0 ? routesWithoutFixes / myRoutes.length : 0,
    myLeads.length > 0 ? assignmentsWithoutScore / myLeads.length : 0,
  ]
  const score = Math.max(0, 1 - penalties.reduce((t, p) => t + p, 0) / penalties.length)

  return {
    repId: input.repId,
    from: input.from,
    to: input.to,
    field,
    doors,
    sales,
    followUp,
    quality,
    completeness: {
      knocksWithoutGps,
      knocksWithoutOutcome,
      assignmentsWithoutScore,
      routesWithoutFixes,
      score,
      notes,
    },
  }
}

/**
 * The same figures for the whole team, which is what a rep is compared against.
 *
 * There is no imported industry benchmark anywhere in this system and there
 * will not be one. Delta Ridge's own numbers are the only honest expectation
 * for a Delta Ridge rep, and a rate borrowed from a trade magazine would be a
 * claim about this team that this team's data had not made.
 */
export function teamPerformance(
  repIds: readonly string[],
  input: Omit<PerformanceInput, 'repId'>,
): RepPerformance[] {
  return repIds.map((repId) => performanceFor({ ...input, repId }))
}

export interface TeamRate {
  value: number | null
  reps: number
  unavailable: string | null
}

/**
 * The team's rate for one metric: pooled, not averaged.
 *
 * Averaging per-rep rates lets a rep with four doors count as much as one with
 * four hundred, which is how a team baseline ends up being mostly noise from
 * whoever knocked least.
 */
export function pooled(
  rates: readonly Rate[],
  minimumDenominator: number,
  what: string,
): TeamRate {
  const numerator = rates.reduce((t, r) => t + r.numerator, 0)
  const denominator = rates.reduce((t, r) => t + r.denominator, 0)
  if (denominator < minimumDenominator) {
    return {
      value: null,
      reps: rates.length,
      unavailable: `The team has only ${denominator} ${what}. Not enough to be an expectation yet.`,
    }
  }
  return { value: numerator / denominator, reps: rates.length, unavailable: null }
}

export { isDecided, isWon }
