import {
  areaAtOrAbovePitch,
  totalAreaSqFt,
  type RoofGeometry,
} from './geometry'

/**
 * Waste derived from geometry, not from a habit.
 *
 * A flat 10% is wrong in both directions: it overcharges a simple gable and
 * short-orders a cut-up hip roof, and when the crew runs out on a Friday the
 * difference comes out of the job, not the spreadsheet.
 *
 * The model is deliberately physical. Every cut along a hip, valley or rake
 * throws away a strip of shingle, so wasted area is (strip width) x (cut
 * length). The widths below are configurable because they depend on the
 * shingle's exposure and the crew's cutting practice - they are not universal
 * constants, and they are the first thing to calibrate against real job
 * actuals once Delta Ridge has them.
 *
 * Starter, hip/ridge cap and ridge vent are NOT waste. They are their own
 * line items, and folding them into a waste percentage is how a bid ends up
 * with material nobody can point to.
 */
export interface WasteModelConfig {
  /**
   * Unavoidable handling waste on any roof: damaged bundles, the last course,
   * offcuts at penetrations. Basis points of field area.
   */
  readonly baseBps: number
  /** Feet of shingle lost per LF of hip or valley cut. */
  readonly hipValleyStripFt: number
  /** Feet of shingle lost per LF of rake cut. */
  readonly rakeStripFt: number
  /** Extra bps applied to area at or above the steep threshold. */
  readonly steepSurchargeBps: number
  readonly steepPitchRise: number
  /** Guard rails. A model that returns 40% is wrong, not insightful. */
  readonly minBps: number
  readonly maxBps: number
}

/**
 * Defaults are starting points, documented so they can be argued with:
 * - 3.00% base is the low end of what a simple gable actually loses.
 * - 0.75 ft per LF of hip/valley assumes roughly a half to three-quarter
 *   shingle width discarded on each cut course.
 * - 0.25 ft per LF of rake assumes a narrower trim cut.
 * - 2.00% extra above 8/12 covers slower, less economical cutting on steep work.
 */
export const DEFAULT_WASTE_MODEL: WasteModelConfig = {
  baseBps: 300,
  hipValleyStripFt: 0.75,
  rakeStripFt: 0.25,
  steepSurchargeBps: 200,
  steepPitchRise: 8,
  minBps: 300,
  maxBps: 2200,
}

export interface WasteComponent {
  readonly source: 'base' | 'hips_valleys' | 'rakes' | 'steep'
  readonly wasteSqFt: number
  readonly explanation: string
}

export interface WasteResult {
  readonly fieldAreaSqFt: number
  readonly components: readonly WasteComponent[]
  readonly wasteSqFt: number
  readonly wasteBps: number
  readonly orderAreaSqFt: number
  /** True when the model hit a guard rail, so the UI can say so. */
  readonly clamped: boolean
}

export function calculateWaste(
  geometry: RoofGeometry,
  config: WasteModelConfig = DEFAULT_WASTE_MODEL,
): WasteResult {
  const fieldAreaSqFt = totalAreaSqFt(geometry)
  if (fieldAreaSqFt <= 0) {
    return {
      fieldAreaSqFt: 0,
      components: [],
      wasteSqFt: 0,
      wasteBps: 0,
      orderAreaSqFt: 0,
      clamped: false,
    }
  }

  const cutLf = geometry.hipLf + geometry.valleyLf
  const steepAreaSqFt = areaAtOrAbovePitch(geometry, config.steepPitchRise)

  const components: WasteComponent[] = [
    {
      source: 'base',
      wasteSqFt: (fieldAreaSqFt * config.baseBps) / 10_000,
      explanation: `${(config.baseBps / 100).toFixed(2)}% handling waste on ${fieldAreaSqFt.toFixed(0)} SF`,
    },
    {
      source: 'hips_valleys',
      wasteSqFt: cutLf * config.hipValleyStripFt,
      explanation: `${cutLf.toFixed(0)} LF of hip and valley cuts at ${config.hipValleyStripFt} ft of shingle per LF`,
    },
    {
      source: 'rakes',
      wasteSqFt: geometry.rakeLf * config.rakeStripFt,
      explanation: `${geometry.rakeLf.toFixed(0)} LF of rake cuts at ${config.rakeStripFt} ft of shingle per LF`,
    },
    {
      source: 'steep',
      wasteSqFt: (steepAreaSqFt * config.steepSurchargeBps) / 10_000,
      explanation:
        steepAreaSqFt > 0
          ? `${steepAreaSqFt.toFixed(0)} SF at or above ${config.steepPitchRise}/12`
          : 'no facets at or above the steep threshold',
    },
  ]

  const rawWasteSqFt = components.reduce((sum, c) => sum + c.wasteSqFt, 0)
  const rawBps = (rawWasteSqFt / fieldAreaSqFt) * 10_000
  const clampedBps = Math.min(Math.max(rawBps, config.minBps), config.maxBps)
  const clamped = clampedBps !== rawBps

  const wasteSqFt = (fieldAreaSqFt * clampedBps) / 10_000

  return {
    fieldAreaSqFt,
    components,
    wasteSqFt,
    wasteBps: clampedBps,
    orderAreaSqFt: fieldAreaSqFt + wasteSqFt,
    clamped,
  }
}

export interface WasteOverride {
  readonly wasteBps: number
  readonly reason: string
  readonly overriddenBy: string
}

export interface AppliedWaste extends WasteResult {
  readonly override: WasteOverride | null
}

/**
 * An override is always recorded with a reason and an author. Silent
 * overrides are how waste becomes a hidden margin bucket, which makes the
 * estimate impossible to defend line by line.
 */
export function applyWasteOverride(
  result: WasteResult,
  override: WasteOverride | null,
): AppliedWaste {
  if (!override) return { ...result, override: null }
  if (!override.reason.trim()) {
    throw new Error('a waste override requires a reason')
  }
  const wasteSqFt = (result.fieldAreaSqFt * override.wasteBps) / 10_000
  return {
    ...result,
    wasteSqFt,
    wasteBps: override.wasteBps,
    orderAreaSqFt: result.fieldAreaSqFt + wasteSqFt,
    override,
  }
}
