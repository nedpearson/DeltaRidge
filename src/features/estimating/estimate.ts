import { buildJobCost, type JobCost, type JobCostCategory, type OverheadPolicy } from './cost'
import { sumCents, type Cents } from './money'
import type { Unit } from './price-book'

/**
 * An estimate line and the reason it exists.
 *
 * `reason` is not decoration. A rep standing in a kitchen gets asked "why is
 * that on there?" about drip edge, starter strip and ice barrier on every
 * other job, and "the software added it" loses the sale. It is also the field
 * that keeps a customer upgrade from being presented as though an insurer or
 * a code required it, which is the line between a defensible estimate and a
 * misrepresentation.
 */
export type ScopeReason =
  | 'code_required'
  | 'manufacturer_required'
  | 'warranty_required'
  | 'delta_ridge_standard'
  | 'customer_upgrade'
  | 'existing_condition'
  | 'access_condition'
  | 'allowance'

export type EvidenceKind =
  | 'measurement'
  | 'photo'
  | 'inspection_finding'
  | 'code_citation'
  | 'manufacturer_instruction'
  | 'supplier_quote'
  | 'subcontract_quote'
  | 'customer_request'

export interface ScopeEvidence {
  readonly kind: EvidenceKind
  /** Row id in the table the evidence lives in, when there is one. */
  readonly referenceId: string | null
  readonly summary: string
}

export interface EstimateLine {
  readonly id: string
  readonly sortOrder: number
  readonly category: JobCostCategory
  readonly description: string
  readonly quantity: number
  readonly unit: Unit
  /** What Delta Ridge pays. Never shown to a homeowner. */
  readonly cost: Cents
  readonly reason: ScopeReason
  readonly evidence: readonly ScopeEvidence[]
  /** A line the rep may drop without changing the roofing system. */
  readonly optional: boolean
  readonly materialItemId: string | null
  readonly laborItemId: string | null
}

export type EstimateMode = 'retail' | 'insurance_restoration' | 'fortified'

export interface EstimateVersion {
  readonly id: string
  readonly estimateId: string
  readonly versionNumber: number
  readonly mode: EstimateMode
  readonly lines: readonly EstimateLine[]
  /** Everything needed to reproduce this version's numbers, months later. */
  readonly provenance: EstimateProvenance
  readonly createdAt: string
  readonly createdBy: string
}

export interface EstimateProvenance {
  readonly priceBookVersion: string
  readonly pricedAsOf: string
  readonly wasteModelVersion: string
  readonly marginPolicyVersion: string
  readonly geometrySource: string
  readonly jurisdictionRuleVersion: string | null
}

export interface EstimateTotals {
  readonly jobCost: JobCost
  readonly byCategory: ReadonlyMap<JobCostCategory, Cents>
  readonly requiredCost: Cents
  readonly optionalCost: Cents
}

export function totalsFor(
  version: EstimateVersion,
  overheadPolicy: OverheadPolicy,
): EstimateTotals {
  const byCategory = new Map<JobCostCategory, Cents>()
  for (const line of version.lines) {
    const current = byCategory.get(line.category)
    byCategory.set(line.category, sumCents(current === undefined ? [line.cost] : [current, line.cost]))
  }

  const required = version.lines.filter((l) => !l.optional)
  const optional = version.lines.filter((l) => l.optional)

  return {
    jobCost: buildJobCost(
      required.map((l) => ({
        category: l.category,
        description: l.description,
        amount: l.cost,
      })),
      overheadPolicy,
    ),
    byCategory,
    requiredCost: sumCents(required.map((l) => l.cost)),
    optionalCost: sumCents(optional.map((l) => l.cost)),
  }
}

/** Lines the estimator has to justify out loud, grouped for the UI. */
export function linesNeedingEvidence(version: EstimateVersion): readonly EstimateLine[] {
  return version.lines.filter(
    (l) =>
      l.evidence.length === 0 &&
      (l.reason === 'code_required' ||
        l.reason === 'existing_condition' ||
        l.reason === 'access_condition'),
  )
}

/**
 * A version is never edited. Revising an estimate appends a new version, so
 * the document a homeowner was shown on the 14th still exists on the 30th.
 */
export function nextVersion(
  previous: EstimateVersion,
  changes: {
    readonly lines: readonly EstimateLine[]
    readonly provenance: EstimateProvenance
    readonly createdAt: string
    readonly createdBy: string
    readonly mode?: EstimateMode
  },
): EstimateVersion {
  return {
    id: `${previous.estimateId}:v${previous.versionNumber + 1}`,
    estimateId: previous.estimateId,
    versionNumber: previous.versionNumber + 1,
    mode: changes.mode ?? previous.mode,
    lines: changes.lines,
    provenance: changes.provenance,
    createdAt: changes.createdAt,
    createdBy: changes.createdBy,
  }
}
