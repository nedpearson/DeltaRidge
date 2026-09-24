/**
 * The numbers a manager is shown, and the arithmetic behind every one of them.
 *
 * Two rules shape this whole file.
 *
 * First: no black boxes. Every figure here returns the parts it was built from,
 * so a manager can put the breakdown in front of a rep and the rep can argue
 * with it. A score somebody cannot check is a score they cannot trust, and a
 * number about a person's work that they cannot interrogate is worse than no
 * number at all.
 *
 * Second: too little data is an answer. These functions return `null` and a
 * reason rather than a confident figure computed from four doors. The temptation
 * in a young system is to show a number because the screen has a space for it,
 * and that number then gets quoted in a conversation about somebody's job.
 */

import { asDoorOutcome, isConversation } from '@/features/leads/pipeline'

export type LeadStatusText = string

/** Statuses that mean the lead has stopped moving, one way or the other. */
export const DECIDED_STATUSES = new Set([
  'sold',
  'lost',
  'not_interested',
  'do_not_contact',
])

/** The ones that mean it was won. Kept narrow on purpose. */
export const WON_STATUSES = new Set(['sold'])

export interface AssignmentOutcome {
  repId: string
  /** The score frozen at the moment this door was handed over. Never live. */
  scoreAtAssignment: number
  status: LeadStatusText
}

export function isDecided(status: LeadStatusText): boolean {
  return DECIDED_STATUSES.has(status)
}

export function isWon(status: LeadStatusText): boolean {
  return WON_STATUSES.has(status)
}

/**
 * Score bands.
 *
 * Coarse deliberately. The scoring model separates doors into a narrow range —
 * most of a run lands in the thirties and forties — so slicing finer would
 * produce bands of two leads each and an "expected" figure built on noise.
 */
export const BAND_EDGES = [0, 30, 40, 50, 60, 101] as const

export function bandOf(score: number): number {
  for (let i = BAND_EDGES.length - 2; i >= 0; i -= 1) {
    if (score >= (BAND_EDGES[i] as number)) return i
  }
  return 0
}

export function bandLabel(band: number): string {
  const low = BAND_EDGES[band] as number
  const high = BAND_EDGES[band + 1] as number
  return high > 100 ? `${low}+` : `${low}–${high - 1}`
}

export interface BandRate {
  band: number
  label: string
  decided: number
  won: number
  /** Null when the band has too few decided leads to mean anything. */
  rate: number | null
}

/** Below this, a band's conversion rate is noise and is not reported. */
export const MIN_DECIDED_PER_BAND = 15
/** Below this, a rep gets no index at all. */
export const MIN_DECIDED_PER_REP = 20

/**
 * What the whole team converts, by score band.
 *
 * The baseline is the organisation's own history and nothing else. There is no
 * imported industry figure and no hand-set expectation, because either would be
 * a claim about Delta Ridge that Delta Ridge's own numbers had not made.
 */
export function orgBaseline(outcomes: readonly AssignmentOutcome[]): BandRate[] {
  const bands = new Map<number, { decided: number; won: number }>()
  for (const o of outcomes) {
    if (!isDecided(o.status)) continue
    const b = bandOf(o.scoreAtAssignment)
    const cell = bands.get(b) ?? { decided: 0, won: 0 }
    cell.decided += 1
    if (isWon(o.status)) cell.won += 1
    bands.set(b, cell)
  }
  return [...bands.entries()]
    .map(([band, cell]) => ({
      band,
      label: bandLabel(band),
      decided: cell.decided,
      won: cell.won,
      rate: cell.decided >= MIN_DECIDED_PER_BAND ? cell.won / cell.decided : null,
    }))
    .sort((a, b) => a.band - b.band)
}

export interface EfficiencyContribution {
  label: string
  /** Doors this rep was given in this band, that have since been decided. */
  decided: number
  /** What the team converts in this band. */
  teamRate: number | null
  /** Wins the team's own rate would predict for those doors. */
  expected: number | null
  actual: number
}

export interface EfficiencyResult {
  repId: string
  decided: number
  won: number
  /** Actual wins over expected wins. Null when there is not enough to say. */
  index: number | null
  expected: number | null
  /** Why there is no index, when there is none. Shown to the manager verbatim. */
  unavailable: string | null
  /** The full arithmetic, band by band. */
  contributions: EfficiencyContribution[]
}

/**
 * How a rep did against the doors they were actually given.
 *
 * This is the whole point of freezing the score at assignment. Raw contract
 * count answers "who closed the most", which is mostly a question about who was
 * handed the best streets. Comparing each rep's results against what the TEAM
 * converts on doors of the same quality is the only version of the question
 * that a rep can be held to fairly.
 *
 * An index of 1.0 means they did exactly what those doors were worth. It is not
 * a grade, it does not decide anything by itself, and the screen says so.
 */
export function efficiencyFor(
  repId: string,
  outcomes: readonly AssignmentOutcome[],
  baseline: readonly BandRate[],
): EfficiencyResult {
  const rates = new Map(baseline.map((b) => [b.band, b]));
  const mine = outcomes.filter((o) => o.repId === repId && isDecided(o.status))

  const byBand = new Map<number, { decided: number; won: number }>()
  for (const o of mine) {
    const b = bandOf(o.scoreAtAssignment)
    const cell = byBand.get(b) ?? { decided: 0, won: 0 }
    cell.decided += 1
    if (isWon(o.status)) cell.won += 1
    byBand.set(b, cell)
  }

  const contributions: EfficiencyContribution[] = [...byBand.entries()]
    .map(([band, cell]) => {
      const teamRate = rates.get(band)?.rate ?? null
      return {
        label: bandLabel(band),
        decided: cell.decided,
        teamRate,
        expected: teamRate === null ? null : teamRate * cell.decided,
        actual: cell.won,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  const won = mine.filter((o) => isWon(o.status)).length
  const decided = mine.length

  if (decided < MIN_DECIDED_PER_REP) {
    return {
      repId,
      decided,
      won,
      index: null,
      expected: null,
      unavailable: `Only ${decided} of their doors have been decided. This needs at least ${MIN_DECIDED_PER_REP} before it means anything.`,
      contributions,
    }
  }

  // Bands the team itself has no rate for are dropped from both sides, rather
  // than being given a made-up expectation.
  const usable = contributions.filter((c) => c.expected !== null)
  const expected = usable.reduce((total, c) => total + (c.expected ?? 0), 0)
  const actual = usable.reduce((total, c) => total + c.actual, 0)

  if (usable.length === 0 || expected <= 0) {
    return {
      repId,
      decided,
      won,
      index: null,
      expected: null,
      unavailable:
        'The team has not closed enough doors at these scores yet for there to be anything to compare against.',
      contributions,
    }
  }

  return {
    repId,
    decided,
    won,
    index: actual / expected,
    expected,
    unavailable: null,
    contributions,
  }
}

// ---------------------------------------------------------------------------
// Activity roll-ups
// ---------------------------------------------------------------------------

export interface ActivityRow {
  userId: string | null
  activityType: string
  outcome: string | null
  gpsVerification: string | null
  occurredAt: string
  subdivision: string | null
  /** The street address, so a timeline can name the door rather than the estate. */
  address: string
  leadClientId: string
}

export interface RepActivity {
  repId: string
  knocks: number
  conversations: number
  appointments: number
  doors: number
  verified: number
  probable: number
  unverified: number
  noFix: number
  /**
   * Share of knocks with a USABLE fix that did not place the rep at the door.
   * Null when there are too few usable fixes to say anything.
   */
  offPropertyShare: number | null
}

/** Below this many usable fixes, the off-property share is not reported. */
export const MIN_USABLE_FIXES = 8

export function rollUpActivity(rows: readonly ActivityRow[]): RepActivity[] {
  const byRep = new Map<string, RepActivity>()

  for (const row of rows) {
    const repId = row.userId ?? 'unattributed'
    const rep =
      byRep.get(repId) ??
      ({
        repId,
        knocks: 0,
        conversations: 0,
        appointments: 0,
        doors: 0,
        verified: 0,
        probable: 0,
        unverified: 0,
        noFix: 0,
        offPropertyShare: null,
      } satisfies RepActivity)

    if (row.activityType === 'door_knock') rep.knocks += 1
    if (row.activityType === 'appointment') rep.appointments += 1
    // One definition of "a person engaged", shared with the door sheet. This
    // used to be `outcome !== 'no_answer'`, which counted a door hanger, an
    // empty lot and an already-finished roof as conversations and inflated the
    // one rate the grading engine leans on hardest.
    const outcome = asDoorOutcome(row.outcome)
    if (row.activityType === 'door_knock' && outcome && isConversation(outcome)) {
      rep.conversations += 1
    }

    if (row.gpsVerification === 'verified') rep.verified += 1
    else if (row.gpsVerification === 'probable') rep.probable += 1
    else if (row.gpsVerification === 'unverified') rep.unverified += 1
    else rep.noFix += 1

    byRep.set(repId, rep)
  }

  // Distinct doors, counted after the fact so one lead knocked three times is
  // three knocks at one door rather than three doors.
  const doorsByRep = new Map<string, Set<string>>()
  for (const row of rows) {
    const repId = row.userId ?? 'unattributed'
    const set = doorsByRep.get(repId) ?? new Set<string>()
    set.add(row.leadClientId)
    doorsByRep.set(repId, set)
  }

  return [...byRep.values()]
    .map((rep) => {
      const usable = rep.verified + rep.probable + rep.unverified
      return {
        ...rep,
        doors: doorsByRep.get(rep.repId)?.size ?? 0,
        offPropertyShare: usable >= MIN_USABLE_FIXES ? rep.unverified / usable : null,
      }
    })
    .sort((a, b) => b.knocks - a.knocks)
}

// ---------------------------------------------------------------------------
// Territory coverage
// ---------------------------------------------------------------------------

export interface TerritoryCoverage {
  subdivision: string
  /** Doors the engine found here. */
  available: number
  /** Doors somebody has actually stood at. */
  knocked: number
  share: number
  bestScore: number | null
}

/**
 * Which neighbourhoods have been worked and which have not.
 *
 * `available` comes from the device's own door list and `knocked` from the
 * server, so a subdivision nobody has loaded locally shows as zero available
 * rather than as fully covered. Said plainly on the screen, because "100%
 * covered" from an empty denominator is the most confidently wrong number a
 * dashboard can print.
 */
export function territoryCoverage(
  doors: readonly { subdivision?: string | undefined; score: number }[],
  activity: readonly ActivityRow[],
): TerritoryCoverage[] {
  const available = new Map<string, { count: number; best: number }>()
  for (const door of doors) {
    const name = door.subdivision ?? 'Unnamed'
    const cell = available.get(name) ?? { count: 0, best: 0 }
    cell.count += 1
    cell.best = Math.max(cell.best, door.score)
    available.set(name, cell)
  }

  const knocked = new Map<string, Set<string>>()
  for (const row of activity) {
    if (row.activityType !== 'door_knock') continue
    const name = row.subdivision ?? 'Unnamed'
    const set = knocked.get(name) ?? new Set<string>()
    set.add(row.leadClientId)
    knocked.set(name, set)
  }

  const names = new Set([...available.keys(), ...knocked.keys()])
  return [...names]
    .map((subdivision) => {
      const avail = available.get(subdivision)?.count ?? 0
      const hit = knocked.get(subdivision)?.size ?? 0
      return {
        subdivision,
        available: avail,
        knocked: hit,
        // An unknown denominator is reported as 0, never as complete.
        share: avail > 0 ? Math.min(1, hit / avail) : 0,
        bestScore: available.get(subdivision)?.best ?? null,
      }
    })
    .sort((a, b) => b.available - a.available || b.knocked - a.knocked)
}

// ---------------------------------------------------------------------------
// Assignment suggestions
// ---------------------------------------------------------------------------

export interface SuggestionFactor {
  label: string
  /** Positive helps, negative hurts. Shown next to the label, always. */
  weight: number
  detail: string
}

export interface Suggestion {
  repId: string
  score: number
  factors: SuggestionFactor[]
}

export interface RepContext {
  repId: string
  /** Doors currently on their plate. */
  openAssignments: number
  /** Subdivisions they have knocked in the window being looked at. */
  workedSubdivisions: Set<string>
  /** Their index, if there is one. Absent is normal and not a penalty. */
  efficiency: number | null
}

/** Doors above this and a rep is stretched; the suggestion says so. */
export const COMFORTABLE_OPEN_ASSIGNMENTS = 25

/**
 * Who this door should probably go to, and why in full.
 *
 * Decision support and nothing else. It ranks, it explains every term, and a
 * manager assigns. It never assigns anything itself, and the factor list is
 * returned whole so the reasoning can be read rather than trusted.
 *
 * Efficiency is deliberately the smallest term. Giving the best doors to whoever
 * is already converting best is how a team ends up with one rep who looks
 * excellent and three who never got a chance to.
 */
export function suggestAssignees(
  lead: { subdivision?: string | undefined; score: number },
  reps: readonly RepContext[],
): Suggestion[] {
  return reps
    .map((rep) => {
      const factors: SuggestionFactor[] = []

      const subdivision = lead.subdivision ?? null
      if (subdivision && rep.workedSubdivisions.has(subdivision)) {
        factors.push({
          label: 'Already working this neighbourhood',
          weight: 40,
          detail: `They have knocked doors in ${subdivision}, so this is on their way.`,
        })
      }

      if (rep.openAssignments <= COMFORTABLE_OPEN_ASSIGNMENTS) {
        factors.push({
          label: 'Has room',
          weight: Math.round(30 * (1 - rep.openAssignments / COMFORTABLE_OPEN_ASSIGNMENTS)),
          detail: `${rep.openAssignments} doors open.`,
        })
      } else {
        factors.push({
          label: 'Already stretched',
          weight: -Math.min(40, rep.openAssignments - COMFORTABLE_OPEN_ASSIGNMENTS),
          detail: `${rep.openAssignments} doors open, past the ${COMFORTABLE_OPEN_ASSIGNMENTS} that is comfortable.`,
        })
      }

      if (rep.efficiency !== null) {
        factors.push({
          label: rep.efficiency >= 1 ? 'Converting above the team rate' : 'Converting below the team rate',
          // Small on purpose, and capped. See the note above.
          weight: Math.max(-15, Math.min(15, Math.round((rep.efficiency - 1) * 30))),
          detail: `Index ${rep.efficiency.toFixed(2)} against doors of the same score.`,
        })
      } else {
        factors.push({
          label: 'No index yet',
          weight: 0,
          detail: 'Not enough decided doors to compare. Counts neither for nor against.',
        })
      }

      return {
        repId: rep.repId,
        score: factors.reduce((total, f) => total + f.weight, 0),
        factors,
      }
    })
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Live field view
// ---------------------------------------------------------------------------

export interface RouteRow {
  id: string
  userId: string
  label: string | null
  startedAt: string
  endedAt: string | null
  pointCount: number
  firstFixAt: string | null
  lastFixAt: string | null
  /** Breaks the rep declared. Carried so a manager sees the same route the rep did. */
  pauses: { at: string; until?: string }[]
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
}

export type FixFreshness = 'live' | 'recent' | 'stale' | 'none'

/** Older than this and the dot on a map is a guess, not a location. */
export const FIX_STALE_SECONDS = 600
export const FIX_RECENT_SECONDS = 120

export function fixFreshness(lastFixAt: string | null, now = Date.now()): FixFreshness {
  if (!lastFixAt) return 'none'
  const age = (now - Date.parse(lastFixAt)) / 1000
  if (!Number.isFinite(age)) return 'none'
  if (age <= FIX_RECENT_SECONDS) return 'live'
  if (age <= FIX_STALE_SECONDS) return 'recent'
  return 'stale'
}

/**
 * Sessions still open, newest first.
 *
 * Open sessions only. A manager watching where people are after they have
 * stopped work is not a status board, and this function is the only thing the
 * live screen reads.
 */
export function activeRoutes(rows: readonly RouteRow[]): RouteRow[] {
  return rows
    .filter((r) => !r.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
