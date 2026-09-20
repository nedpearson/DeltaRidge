import { areaAtOrAbovePitch, countPenetrations, totalAreaSqFt, type RoofGeometry } from './geometry'
import { calculateWaste, type WasteResult } from './waste'
import { extendScope } from './price-book'
import { buildJobCost, solvePrice, type JobCostLine, type PricingSolution } from './cost'
import { priceLadder, type PriceLadder } from './margin'
import { ZERO_CENTS, type Cents } from './money'
import type { EstimateLine, ScopeEvidence } from './estimate'
import {
  marginPolicyFrom,
  overheadPolicyFrom,
  ratesFrom,
  unitPriceFor,
  type CostKey,
  type CostSheet,
  type MarginSettings,
} from './store'

/**
 * Turns a measured roof plus Delta Ridge's own costs into a priced estimate.
 *
 * The rule that shapes everything: a component with no cost entered produces a
 * GAP, not a zero. A zero would silently under-price the roof and the number
 * would still look finished, which is the single most expensive thing this
 * module could do. Gaps are returned alongside the lines so the screen can say
 * exactly which figure is missing and what it would change.
 */

export interface CostGap {
  readonly key: CostKey
  readonly description: string
  readonly quantity: number
  readonly unit: string
}

export interface BuiltEstimate {
  readonly geometry: RoofGeometry
  readonly waste: WasteResult
  readonly lines: readonly EstimateLine[]
  readonly gaps: readonly CostGap[]
  readonly directCost: Cents
  readonly overhead: Cents
  readonly jobCost: Cents
  readonly ladder: PriceLadder
  readonly recommended: PricingSolution
}

interface Component {
  readonly key: CostKey
  readonly description: string
  readonly category: EstimateLine['category']
  readonly unit: string
  readonly quantity: number
  readonly reason: EstimateLine['reason']
  readonly evidence: readonly ScopeEvidence[]
  readonly optional?: boolean
}

function measurement(summary: string): ScopeEvidence[] {
  return [{ kind: 'measurement', referenceId: null, summary }]
}

/** Scope a shingle re-roof implies, derived from geometry alone. */
export function componentsFor(
  geometry: RoofGeometry,
  waste: WasteResult,
): readonly Component[] {
  const fieldSq = totalAreaSqFt(geometry) / 100
  const orderSq = waste.orderAreaSqFt / 100
  const capLf = geometry.ridgeLf + geometry.hipLf
  const dripLf = geometry.eaveLf + geometry.rakeLf
  const steepSq = areaAtOrAbovePitch(geometry, 8) / 100
  const boots = countPenetrations(geometry, 'pipe_boot')

  const out: Component[] = [
    {
      key: 'shingle_sq', description: 'Architectural shingle', category: 'material',
      unit: 'SQ', quantity: orderSq, reason: 'delta_ridge_standard',
      evidence: measurement(
        `${fieldSq.toFixed(2)} SQ measured plus ${(waste.wasteBps / 100).toFixed(2)}% calculated waste`,
      ),
    },
    {
      key: 'underlayment_sq', description: 'Synthetic underlayment', category: 'material',
      unit: 'SQ', quantity: fieldSq, reason: 'manufacturer_required',
      evidence: measurement(`${fieldSq.toFixed(2)} SQ of deck`),
    },
    {
      key: 'starter_lf', description: 'Starter course', category: 'material',
      unit: 'LF', quantity: dripLf, reason: 'manufacturer_required',
      evidence: measurement(`${geometry.eaveLf} LF eave + ${geometry.rakeLf} LF rake`),
    },
    {
      key: 'cap_lf', description: 'Hip and ridge cap', category: 'material',
      unit: 'LF', quantity: capLf, reason: 'manufacturer_required',
      evidence: measurement(`${geometry.ridgeLf} LF ridge + ${geometry.hipLf} LF hip`),
    },
    {
      key: 'drip_edge_lf', description: 'Drip edge', category: 'material',
      unit: 'LF', quantity: dripLf, reason: 'delta_ridge_standard',
      evidence: measurement(`${geometry.eaveLf} LF eave + ${geometry.rakeLf} LF rake`),
    },
    {
      key: 'valley_lf', description: 'Valley metal', category: 'material',
      unit: 'LF', quantity: geometry.valleyLf, reason: 'delta_ridge_standard',
      evidence: measurement(`${geometry.valleyLf} LF of valley`),
    },
    {
      key: 'pipe_boot_ea', description: 'Pipe boot', category: 'material',
      unit: 'EA', quantity: boots, reason: 'delta_ridge_standard',
      evidence: measurement(`${boots} documented`),
    },
    {
      key: 'tear_off_sq', description: 'Tear off existing roof', category: 'labor',
      unit: 'SQ', quantity: fieldSq * geometry.existingLayers, reason: 'existing_condition',
      evidence: measurement(
        `${fieldSq.toFixed(2)} SQ x ${geometry.existingLayers} existing layer(s)`,
      ),
    },
    {
      key: 'install_sq', description: 'Install shingle system', category: 'labor',
      unit: 'SQ', quantity: fieldSq, reason: 'delta_ridge_standard',
      evidence: measurement(`${fieldSq.toFixed(2)} SQ`),
    },
    {
      key: 'steep_sq', description: 'Steep slope adder', category: 'labor',
      unit: 'SQ', quantity: steepSq, reason: 'access_condition',
      evidence: measurement(`${steepSq.toFixed(2)} SQ at or above 8/12`),
    },
    {
      key: 'high_job', description: 'High roof adder', category: 'access',
      unit: 'EA', quantity: geometry.stories >= 2 || geometry.eaveHeightFt >= 20 ? 1 : 0,
      reason: 'access_condition',
      evidence: measurement(
        `${geometry.stories} storey, ${geometry.eaveHeightFt} ft to the eave`,
      ),
    },
    {
      key: 'disposal_job', description: 'Disposal', category: 'disposal',
      unit: 'EA', quantity: 1, reason: 'delta_ridge_standard', evidence: [],
    },
    {
      key: 'permit_job', description: 'Permit', category: 'permit',
      unit: 'EA', quantity: 1, reason: 'code_required',
      evidence: [{ kind: 'code_citation', referenceId: 'la-permit-roofing-statewide',
        summary: 'Roofing permit required statewide (2025 Act 239)' }],
    },
  ]

  // A component that measures zero is dropped rather than priced at zero, so a
  // gable estimate carries no empty valley line and no phantom steep charge.
  return out.filter((c) => c.quantity > 0)
}

export function buildEstimate(
  geometry: RoofGeometry,
  costs: CostSheet,
  margins: MarginSettings,
): BuiltEstimate {
  const waste = calculateWaste(geometry)
  const components = componentsFor(geometry, waste)

  const lines: EstimateLine[] = []
  const gaps: CostGap[] = []

  components.forEach((component, index) => {
    const price = unitPriceFor(costs, component.key)
    if (price === null) {
      gaps.push({
        key: component.key,
        description: component.description,
        quantity: component.quantity,
        unit: component.unit,
      })
      return
    }
    lines.push({
      id: component.key,
      sortOrder: index,
      category: component.category,
      description: component.description,
      quantity: component.quantity,
      unit: component.unit as EstimateLine['unit'],
      cost: extendScope(component.quantity, price),
      reason: component.reason,
      evidence: component.evidence,
      optional: component.optional ?? false,
      materialItemId: null,
      laborItemId: null,
    })
  })

  const costLines: JobCostLine[] = lines.map((l) => ({
    category: l.category,
    description: l.description,
    amount: l.cost,
  }))

  const jobCost = buildJobCost(costLines, overheadPolicyFrom(margins))
  const policy = marginPolicyFrom(margins)
  const rates = ratesFrom(margins)

  // A ladder off a zero cost is meaningless, and solvePrice would divide a
  // zero into a zero. Return an honest empty rather than a confident $0.
  const ladder: PriceLadder =
    jobCost.total > 0
      ? priceLadder(jobCost.total, policy)
      : { standard: ZERO_CENTS, target: ZERO_CENTS, floor: ZERO_CENTS, stop: ZERO_CENTS }

  const recommended =
    jobCost.total > 0
      ? solvePrice(jobCost.total, policy.standardMargin, rates)
      : {
          price: ZERO_CENTS, jobCost: ZERO_CENTS, commission: ZERO_CENTS,
          financingDealerFee: ZERO_CENTS, cardProcessing: ZERO_CENTS,
          totalCost: ZERO_CENTS, grossProfit: ZERO_CENTS,
          realisedMargin: policy.standardMargin,
        }

  return {
    geometry,
    waste,
    lines,
    gaps,
    directCost: jobCost.directCost,
    overhead: jobCost.overhead,
    jobCost: jobCost.total,
    ladder,
    recommended,
  }
}
