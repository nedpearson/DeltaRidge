import {
  areaAtOrAbovePitch,
  countPenetrations,
  lowSlopeAreaSqFt,
  totalAreaSqFt,
  type PenetrationKind,
  type RoofGeometry,
} from './geometry'
import type { ScopeReason } from './estimate'
import type { JobCostCategory } from './cost'
import type { Unit } from './price-book'
import type { WasteResult } from './waste'

/**
 * An assembly expands into the line items a roofing system actually needs.
 *
 * The point is that it EXPANDS. A $/square number hides whether drip edge,
 * starter, cap and boots were priced, which is exactly what a homeowner
 * comparing two bids needs to see and exactly what gets forgotten when the
 * crew is on the roof. Every component stays visible with its own quantity,
 * its own unit and its own reason.
 */

export type QuantityRule =
  | { readonly kind: 'field_area_sq_ft'; readonly withWaste: boolean }
  | { readonly kind: 'squares'; readonly withWaste: boolean }
  | { readonly kind: 'ridge_lf' }
  | { readonly kind: 'hip_lf' }
  | { readonly kind: 'valley_lf' }
  | { readonly kind: 'eave_lf' }
  | { readonly kind: 'rake_lf' }
  | { readonly kind: 'eave_plus_rake_lf' }
  | { readonly kind: 'ridge_plus_hip_lf' }
  | { readonly kind: 'step_flashing_lf' }
  | { readonly kind: 'wall_flashing_lf' }
  | { readonly kind: 'penetration_count'; readonly penetration: PenetrationKind }
  | { readonly kind: 'low_slope_area_sq_ft' }
  | { readonly kind: 'steep_area_sq_ft'; readonly minRise: number }
  | { readonly kind: 'tear_off_layers_sq' }
  | { readonly kind: 'fixed'; readonly value: number }

export interface AssemblyComponent {
  readonly key: string
  readonly description: string
  readonly category: JobCostCategory
  readonly unit: Unit
  readonly rule: QuantityRule
  readonly reason: ScopeReason
  readonly materialItemId: string | null
  readonly laborItemId: string | null
  readonly optional: boolean
}

export interface Assembly {
  readonly id: string
  readonly name: string
  readonly components: readonly AssemblyComponent[]
}

export interface ExpandedComponent {
  readonly key: string
  readonly description: string
  readonly category: JobCostCategory
  readonly quantity: number
  readonly unit: Unit
  readonly reason: ScopeReason
  readonly materialItemId: string | null
  readonly laborItemId: string | null
  readonly optional: boolean
  /** How the quantity was derived, in words, for the evidence trail. */
  readonly derivation: string
}

export function resolveQuantity(
  rule: QuantityRule,
  geometry: RoofGeometry,
  waste: WasteResult,
): { readonly quantity: number; readonly derivation: string } {
  switch (rule.kind) {
    case 'field_area_sq_ft': {
      const q = rule.withWaste ? waste.orderAreaSqFt : totalAreaSqFt(geometry)
      return {
        quantity: q,
        derivation: rule.withWaste
          ? `${totalAreaSqFt(geometry).toFixed(0)} SF field area plus ${(waste.wasteBps / 100).toFixed(2)}% calculated waste`
          : `${q.toFixed(0)} SF field area`,
      }
    }
    case 'squares': {
      const sqFt = rule.withWaste ? waste.orderAreaSqFt : totalAreaSqFt(geometry)
      return {
        quantity: sqFt / 100,
        derivation: `${(sqFt / 100).toFixed(2)} SQ${rule.withWaste ? ' including waste' : ''}`,
      }
    }
    case 'ridge_lf':
      return { quantity: geometry.ridgeLf, derivation: `${geometry.ridgeLf} LF of ridge` }
    case 'hip_lf':
      return { quantity: geometry.hipLf, derivation: `${geometry.hipLf} LF of hip` }
    case 'valley_lf':
      return { quantity: geometry.valleyLf, derivation: `${geometry.valleyLf} LF of valley` }
    case 'eave_lf':
      return { quantity: geometry.eaveLf, derivation: `${geometry.eaveLf} LF of eave` }
    case 'rake_lf':
      return { quantity: geometry.rakeLf, derivation: `${geometry.rakeLf} LF of rake` }
    case 'eave_plus_rake_lf':
      return {
        quantity: geometry.eaveLf + geometry.rakeLf,
        derivation: `${geometry.eaveLf} LF eave + ${geometry.rakeLf} LF rake`,
      }
    case 'ridge_plus_hip_lf':
      return {
        quantity: geometry.ridgeLf + geometry.hipLf,
        derivation: `${geometry.ridgeLf} LF ridge + ${geometry.hipLf} LF hip`,
      }
    case 'step_flashing_lf':
      return {
        quantity: geometry.stepFlashingLf,
        derivation: `${geometry.stepFlashingLf} LF of roof-to-wall step flashing`,
      }
    case 'wall_flashing_lf':
      return {
        quantity: geometry.wallFlashingLf,
        derivation: `${geometry.wallFlashingLf} LF of wall flashing`,
      }
    case 'penetration_count': {
      const n = countPenetrations(geometry, rule.penetration)
      return { quantity: n, derivation: `${n} documented ${rule.penetration.replace(/_/g, ' ')}` }
    }
    case 'low_slope_area_sq_ft': {
      const q = lowSlopeAreaSqFt(geometry)
      return { quantity: q, derivation: `${q.toFixed(0)} SF below 2/12` }
    }
    case 'steep_area_sq_ft': {
      const q = areaAtOrAbovePitch(geometry, rule.minRise)
      return { quantity: q, derivation: `${q.toFixed(0)} SF at or above ${rule.minRise}/12` }
    }
    case 'tear_off_layers_sq': {
      const q = (totalAreaSqFt(geometry) / 100) * geometry.existingLayers
      return {
        quantity: q,
        derivation: `${(totalAreaSqFt(geometry) / 100).toFixed(2)} SQ x ${geometry.existingLayers} existing layer(s)`,
      }
    }
    case 'fixed':
      return { quantity: rule.value, derivation: 'fixed quantity' }
  }
}

/** Components that resolve to zero are dropped, not priced at zero. */
export function expandAssembly(
  assembly: Assembly,
  geometry: RoofGeometry,
  waste: WasteResult,
): readonly ExpandedComponent[] {
  const expanded: ExpandedComponent[] = []
  for (const component of assembly.components) {
    const { quantity, derivation } = resolveQuantity(component.rule, geometry, waste)
    if (quantity <= 0) continue
    expanded.push({
      key: component.key,
      description: component.description,
      category: component.category,
      quantity,
      unit: component.unit,
      reason: component.reason,
      materialItemId: component.materialItemId,
      laborItemId: component.laborItemId,
      optional: component.optional,
      derivation,
    })
  }
  return expanded
}
