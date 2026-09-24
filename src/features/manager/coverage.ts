import { getSupabase } from '@/lib/supabase'

/**
 * Where the team actually went, against where the doors are.
 *
 * The one distinction this module exists to keep:
 *
 *   passed  - the recorded trail came within a few dozen metres of the house.
 *   knocked - somebody recorded an outcome at the house.
 *
 * `passed` is NEVER a visit. A rep whose GPS went down a street did not knock
 * the houses on it, and the moment this product lets those two words blur it
 * has invented the easiest metric in the business to game. It is here for one
 * purpose: the GAP. "You went past 64 doors in Quail Ridge and knocked 12" is
 * the sentence that decides where the team goes tomorrow, and neither number
 * says it alone.
 */

export interface CoverageRow {
  readonly subdivision: string
  /** Doors the office knows about here, whether or not anyone went near them. */
  readonly doorsAvailable: number
  /** Doors the trail went past. Not visits. */
  readonly doorsPassed: number
  /** Doors with a recorded outcome. */
  readonly doorsKnocked: number
  readonly appointments: number
}

/**
 * The radius at which a fix counts as having gone past a house.
 *
 * Matches `atDoorMeters` in routes/verification.ts on purpose: the same
 * distance that would let a knock be called verified is the distance at which
 * the trail is said to have passed. Using a looser number here would mean a
 * street could be "covered" from further away than a knock can be confirmed,
 * which is backwards.
 */
export const PASSED_RADIUS_METERS = 45

export interface CoverageResult {
  readonly rows: CoverageRow[]
  readonly error: string | null
}

export async function readCoverage(
  orgId: string | null,
  from: string,
  to: string,
  radiusMeters: number = PASSED_RADIUS_METERS,
): Promise<CoverageResult> {
  if (!orgId) return { rows: [], error: null }
  const supabase = getSupabase()
  if (!supabase) return { rows: [], error: null }

  const { data, error } = await supabase.rpc('route_coverage', {
    p_org: orgId,
    p_from: from,
    p_to: to,
    p_radius_m: radiusMeters,
  })

  if (error) return { rows: [], error: error.message }

  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    (r): CoverageRow => ({
      subdivision: String(r['subdivision'] ?? 'Unnamed'),
      doorsAvailable: Number(r['doors_available'] ?? 0),
      doorsPassed: Number(r['doors_passed'] ?? 0),
      doorsKnocked: Number(r['doors_knocked'] ?? 0),
      appointments: Number(r['appointments'] ?? 0),
    }),
  )
  return { rows, error: null }
}

// ---------------------------------------------------------------------------
// Reading the gap
// ---------------------------------------------------------------------------

export interface CoverageGap {
  readonly subdivision: string
  /** Went past and did not knock. The number that decides tomorrow. */
  readonly passedNotKnocked: number
  /** Never went near. A different problem with a different answer. */
  readonly untouched: number
  readonly doorsKnocked: number
  readonly doorsAvailable: number
  /**
   * Knocked over passed. Null when nothing was passed - the same rule as the
   * funnel: 0 of 0 is not 0%, it is a question nobody asked.
   */
  readonly workRate: number | null
}

/**
 * Splits what is left into the two kinds of "not done", because they call for
 * opposite responses.
 *
 * A door the team drove past and did not knock is a door on a street they have
 * already paid to reach - the cheapest work available tomorrow. A door nobody
 * went near is a routing decision that was never made. Adding them into one
 * "remaining" figure hides which of the two a manager is looking at.
 */
export function coverageGaps(rows: readonly CoverageRow[]): CoverageGap[] {
  return rows
    .map((r) => ({
      subdivision: r.subdivision,
      passedNotKnocked: Math.max(0, r.doorsPassed - r.doorsKnocked),
      untouched: Math.max(0, r.doorsAvailable - r.doorsPassed),
      doorsKnocked: r.doorsKnocked,
      doorsAvailable: r.doorsAvailable,
      workRate: r.doorsPassed > 0 ? r.doorsKnocked / r.doorsPassed : null,
    }))
    .sort((a, b) => b.passedNotKnocked - a.passedNotKnocked)
}

/**
 * Totals across every neighbourhood.
 *
 * Summed, never averaged. An average of per-subdivision percentages weights a
 * street with three doors the same as an estate with three hundred, which is
 * how a dashboard reports 60% coverage of a parish nobody has finished.
 */
export function coverageTotals(rows: readonly CoverageRow[]): {
  available: number
  passed: number
  knocked: number
  workRate: number | null
} {
  const available = rows.reduce((n, r) => n + r.doorsAvailable, 0)
  const passed = rows.reduce((n, r) => n + r.doorsPassed, 0)
  const knocked = rows.reduce((n, r) => n + r.doorsKnocked, 0)
  return { available, passed, knocked, workRate: passed > 0 ? knocked / passed : null }
}
