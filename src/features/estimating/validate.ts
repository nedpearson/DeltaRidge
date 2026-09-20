import { countPenetrations, lowSlopeAreaSqFt, type RoofGeometry } from './geometry'
import { authorisePrice, type MarginPolicy } from './margin'
import type { Cents } from './money'
import type { EstimateLine, EstimateVersion } from './estimate'
import type { InspectionFacts } from './scope'

/**
 * The check that runs before a proposal can be presented.
 *
 * Its job is to catch the two failures that cost real money and are invisible
 * on screen: scope that was documented and then not priced, and scope that
 * was priced with nothing behind it. Deterministic, ordered and specific -
 * every flag names the thing and points at where to fix it, because "review
 * your estimate" is not a finding.
 */

export type FlagSeverity = 'blocker' | 'warning' | 'note'

export interface ValidationFlag {
  readonly code: string
  readonly severity: FlagSeverity
  readonly message: string
  /** Where the UI should jump to. */
  readonly target:
    | { readonly kind: 'line'; readonly lineId: string }
    | { readonly kind: 'scope'; readonly suggestionKey: string }
    | { readonly kind: 'geometry'; readonly field: string }
    | { readonly kind: 'pricing' }
}

export interface ValidationInput {
  readonly version: EstimateVersion
  readonly facts: InspectionFacts
  readonly sellPrice: Cents | null
  readonly jobCost: Cents
  readonly marginPolicy: MarginPolicy
}

function has(lines: readonly EstimateLine[], pattern: RegExp): boolean {
  return lines.some((l) => pattern.test(l.description))
}

function quantityFor(lines: readonly EstimateLine[], pattern: RegExp): number {
  return lines.filter((l) => pattern.test(l.description)).reduce((s, l) => s + l.quantity, 0)
}

export function validateEstimate(input: ValidationInput): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  const lines = input.version.lines
  const g = input.facts.geometry

  flags.push(...geometryFlags(g))
  flags.push(...componentFlags(lines, g))
  flags.push(...evidenceFlags(lines))
  flags.push(...documentedButUnpricedFlags(lines, input.facts))
  flags.push(...duplicateFlags(lines))
  flags.push(...pricingFlags(input))

  const order: Record<FlagSeverity, number> = { blocker: 0, warning: 1, note: 2 }
  return [...flags].sort((a, b) => order[a.severity] - order[b.severity])
}

function geometryFlags(g: RoofGeometry): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  // An unknown is not a zero. Pricing drip edge off an unmeasured eave length
  // produces a confident number with nothing behind it.
  for (const field of g.unknowns) {
    flags.push({
      code: 'geometry_unknown',
      severity: 'blocker',
      message: `${String(field)} was never measured, so any quantity derived from it is invented.`,
      target: { kind: 'geometry', field: String(field) },
    })
  }
  if (g.facets.length === 0) {
    flags.push({
      code: 'geometry_missing',
      severity: 'blocker',
      message: 'No roof facets recorded. There is nothing to price.',
      target: { kind: 'geometry', field: 'facets' },
    })
  }
  return flags
}

const COMPONENT_CHECKS: readonly {
  readonly code: string
  readonly measure: (g: RoofGeometry) => number
  readonly pattern: RegExp
  readonly noun: string
  readonly unit: string
}[] = [
  {
    code: 'valley_unpriced',
    measure: (g) => g.valleyLf,
    pattern: /valley/i,
    noun: 'valley',
    unit: 'LF',
  },
  {
    code: 'drip_edge_unpriced',
    measure: (g) => g.eaveLf + g.rakeLf,
    pattern: /drip\s*edge/i,
    noun: 'eave and rake',
    unit: 'LF',
  },
  {
    code: 'cap_unpriced',
    measure: (g) => g.ridgeLf + g.hipLf,
    pattern: /(hip|ridge)\s*(and\s*ridge\s*)?cap|cap shingle/i,
    noun: 'ridge and hip',
    unit: 'LF',
  },
  {
    code: 'step_flashing_unpriced',
    measure: (g) => g.stepFlashingLf,
    pattern: /step\s*flashing/i,
    noun: 'roof-to-wall',
    unit: 'LF',
  },
  {
    code: 'low_slope_unpriced',
    measure: (g) => lowSlopeAreaSqFt(g),
    pattern: /low[\s-]*slope|modified bitumen|tpo|epdm/i,
    noun: 'area below 2/12',
    unit: 'SF',
  },
]

function componentFlags(
  lines: readonly EstimateLine[],
  g: RoofGeometry,
): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  for (const check of COMPONENT_CHECKS) {
    const measured = check.measure(g)
    if (measured > 0 && !has(lines, check.pattern)) {
      flags.push({
        code: check.code,
        severity: check.code === 'low_slope_unpriced' ? 'blocker' : 'warning',
        message: `${measured.toFixed(0)} ${check.unit} of ${check.noun} was measured but nothing on the estimate covers it.`,
        target: { kind: 'scope', suggestionKey: check.code },
      })
    }
  }

  const tearOffSq = quantityFor(lines, /tear[\s-]*off/i)
  const neededSq =
    (g.facets.reduce((s, f) => s + f.areaSqFt, 0) / 100) * g.existingLayers
  if (g.existingLayers > 1 && tearOffSq > 0 && tearOffSq + 0.5 < neededSq) {
    flags.push({
      code: 'tear_off_layers_short',
      severity: 'warning',
      message: `${g.existingLayers} existing layers were recorded but the estimate only tears off ${tearOffSq.toFixed(1)} SQ of the ${neededSq.toFixed(1)} SQ implied.`,
      target: { kind: 'scope', suggestionKey: 'tear_off_additional_layer' },
    })
  }
  return flags
}

/**
 * A line claiming a code or a manufacturer requires it, with nothing cited,
 * is the one failure mode here with consequences beyond a thin job. It is a
 * blocker, not a warning.
 */
function evidenceFlags(lines: readonly EstimateLine[]): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  for (const line of lines) {
    if (line.reason === 'code_required' && !line.evidence.some((e) => e.kind === 'code_citation')) {
      flags.push({
        code: 'code_claim_uncited',
        severity: 'blocker',
        message: `"${line.description}" is presented as code-required with no citation attached.`,
        target: { kind: 'line', lineId: line.id },
      })
    }
    if (
      line.reason === 'manufacturer_required' &&
      !line.evidence.some((e) => e.kind === 'manufacturer_instruction')
    ) {
      flags.push({
        code: 'manufacturer_claim_uncited',
        severity: 'blocker',
        message: `"${line.description}" is presented as a manufacturer requirement with no instruction attached.`,
        target: { kind: 'line', lineId: line.id },
      })
    }
    if (
      (line.reason === 'existing_condition' || line.reason === 'access_condition') &&
      line.evidence.length === 0
    ) {
      flags.push({
        code: 'condition_unevidenced',
        severity: 'warning',
        message: `"${line.description}" rests on a site condition with no photo or finding behind it.`,
        target: { kind: 'line', lineId: line.id },
      })
    }
  }
  return flags
}

/** Photographed and then not priced - the quiet way a job loses money. */
function documentedButUnpricedFlags(
  lines: readonly EstimateLine[],
  facts: InspectionFacts,
): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  const checks: readonly {
    readonly code: string
    readonly kind: Parameters<typeof countPenetrations>[1]
    readonly photoCategory: string
    readonly pattern: RegExp
    readonly noun: string
  }[] = [
    {
      code: 'pipe_boots_unpriced',
      kind: 'pipe_boot',
      photoCategory: 'pipe_boot',
      pattern: /pipe\s*boot/i,
      noun: 'pipe boot',
    },
    {
      code: 'chimney_unpriced',
      kind: 'chimney',
      photoCategory: 'chimney',
      pattern: /chimney/i,
      noun: 'chimney',
    },
    {
      code: 'skylight_unpriced',
      kind: 'skylight',
      photoCategory: 'skylight',
      pattern: /skylight/i,
      noun: 'skylight',
    },
  ]

  for (const check of checks) {
    const measured = countPenetrations(facts.geometry, check.kind)
    const photographed = facts.photoCategories.filter(
      (p) => p.category === check.photoCategory,
    ).length
    const documented = Math.max(measured, photographed)
    if (documented === 0) continue

    const priced = quantityFor(lines, check.pattern)
    if (priced === 0) {
      flags.push({
        code: check.code,
        severity: 'warning',
        message: `You documented ${documented} ${check.noun}${documented === 1 ? '' : 's'} but the estimate contains none.`,
        target: { kind: 'scope', suggestionKey: check.code },
      })
    } else if (measured > 0 && priced < measured) {
      flags.push({
        code: `${check.code}_short`,
        severity: 'warning',
        message: `${measured} ${check.noun}s were measured but only ${priced} are priced.`,
        target: { kind: 'scope', suggestionKey: check.code },
      })
    }
  }
  return flags
}

function duplicateFlags(lines: readonly EstimateLine[]): readonly ValidationFlag[] {
  const seen = new Map<string, EstimateLine>()
  const flags: ValidationFlag[] = []
  for (const line of lines) {
    const key = `${line.description.trim().toLowerCase()}|${line.unit}`
    const first = seen.get(key)
    if (first) {
      flags.push({
        code: 'duplicate_line',
        severity: 'warning',
        message: `"${line.description}" appears more than once. Check it is not billed twice.`,
        target: { kind: 'line', lineId: line.id },
      })
    } else {
      seen.set(key, line)
    }
  }
  return flags
}

function pricingFlags(input: ValidationInput): readonly ValidationFlag[] {
  const flags: ValidationFlag[] = []
  if (input.sellPrice === null) {
    flags.push({
      code: 'no_price',
      severity: 'blocker',
      message: 'The estimate has no selling price.',
      target: { kind: 'pricing' },
    })
    return flags
  }

  const verdict = authorisePrice(input.sellPrice, input.jobCost, input.marginPolicy)
  if (!verdict.allowed) {
    flags.push({
      code: 'below_stop_price',
      severity: 'blocker',
      message: `This price cannot be authorised: ${verdict.reason}.`,
      target: { kind: 'pricing' },
    })
  } else if (verdict.level !== 'rep') {
    flags.push({
      code: 'needs_approval',
      severity: 'note',
      message: `This price needs ${verdict.level} approval before it is presented.`,
      target: { kind: 'pricing' },
    })
  }
  return flags
}

export function blockers(flags: readonly ValidationFlag[]): readonly ValidationFlag[] {
  return flags.filter((f) => f.severity === 'blocker')
}

export function canPresent(flags: readonly ValidationFlag[]): boolean {
  return blockers(flags).length === 0
}
