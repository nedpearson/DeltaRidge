import { sumCents, type Cents, cents } from './money'

/**
 * Scope normalisation: comparing two roofing bids by what is in them.
 *
 * "Competitor A $16,900, Delta Ridge $18,050" tells a homeowner almost
 * nothing, and a rep who answers it with a discount has thrown away margin to
 * win an argument they had not yet had. The useful question is whether the
 * $1,150 is explained by permit, boots, ventilation, decking treatment,
 * warranty or materials - and usually most of it is.
 *
 * Two rules keep this honest, and both cut against us:
 *
 * 1. UNKNOWN IS NOT EXCLUDED. A competitor proposal that does not mention
 *    drip edge has not said it is omitted. It goes in the unknown bucket, it
 *    is never presented as a gap, and its value never counts toward the
 *    explained total. The output says "not specified", which is also the only
 *    thing a rep should say out loud.
 *
 * 2. A GAP IS VALUED AT OUR COST, NOT THEIR PRICE. We do not know what the
 *    other contractor would have charged for a boot. Every attributed amount
 *    is labelled as Delta Ridge's own cost for that component, so the
 *    comparison never pretends to price someone else's work.
 */

export type ScopeComponentKey =
  | 'tear_off'
  | 'field_shingle'
  | 'underlayment'
  | 'leak_barrier'
  | 'starter'
  | 'hip_ridge_cap'
  | 'drip_edge'
  | 'valley'
  | 'step_flashing'
  | 'counterflashing'
  | 'pipe_boots'
  | 'ridge_vent'
  | 'box_vents'
  | 'decking_allowance'
  | 'detach_reset'
  | 'permit'
  | 'cleanup'
  | 'gutters'
  | 'warranty_workmanship'
  | 'warranty_manufacturer'

export const SCOPE_COMPONENT_LABELS: Record<ScopeComponentKey, string> = {
  tear_off: 'Tear-off',
  field_shingle: 'Field shingle',
  underlayment: 'Underlayment',
  leak_barrier: 'Leak barrier',
  starter: 'Starter course',
  hip_ridge_cap: 'Hip and ridge cap',
  drip_edge: 'Drip edge',
  valley: 'Valley',
  step_flashing: 'Step flashing',
  counterflashing: 'Counterflashing',
  pipe_boots: 'Pipe boots',
  ridge_vent: 'Ridge ventilation',
  box_vents: 'Box vents',
  decking_allowance: 'Decking allowance',
  detach_reset: 'Detach and reset',
  permit: 'Permit',
  cleanup: 'Cleanup and protection',
  gutters: 'Gutters',
  warranty_workmanship: 'Workmanship warranty',
  warranty_manufacturer: 'Manufacturer warranty',
}

/**
 * The state of one component in one proposal.
 *
 * `unknown` and `excluded` are different facts and are never collapsed.
 */
export type ComponentState =
  | { readonly kind: 'included'; readonly detail: string | null }
  | { readonly kind: 'allowance'; readonly detail: string }
  | { readonly kind: 'excluded'; readonly detail: string | null }
  | { readonly kind: 'unknown' }

export interface NormalisedScope {
  readonly source: 'delta_ridge' | 'competitor'
  readonly label: string
  readonly total: Cents | null
  readonly components: ReadonlyMap<ScopeComponentKey, ComponentState>
}

export const ALL_COMPONENT_KEYS: readonly ScopeComponentKey[] = Object.keys(
  SCOPE_COMPONENT_LABELS,
) as ScopeComponentKey[]

/** Anything not asserted by the document is unknown, never absent. */
export function normalisedScope(
  source: NormalisedScope['source'],
  label: string,
  total: Cents | null,
  asserted: ReadonlyMap<ScopeComponentKey, ComponentState>,
): NormalisedScope {
  const components = new Map<ScopeComponentKey, ComponentState>()
  for (const key of ALL_COMPONENT_KEYS) {
    components.set(key, asserted.get(key) ?? { kind: 'unknown' })
  }
  return { source, label, total, components }
}

export type ComparisonVerdict =
  | 'both_include'
  | 'we_include_they_do_not'
  | 'they_include_we_do_not'
  | 'both_exclude'
  | 'not_specified'
  | 'differs'

export interface ComparisonRow {
  readonly key: ScopeComponentKey
  readonly label: string
  readonly ours: ComponentState
  readonly theirs: ComponentState
  readonly verdict: ComparisonVerdict
  /** Exactly what a rep may say about this row. Never a characterisation. */
  readonly statement: string
}

function describe(state: ComponentState): string {
  switch (state.kind) {
    case 'included':
      return state.detail ?? 'Included'
    case 'allowance':
      return `Allowance: ${state.detail}`
    case 'excluded':
      return state.detail === null ? 'Excluded' : `Excluded: ${state.detail}`
    case 'unknown':
      return 'Not specified'
  }
}

function verdictFor(ours: ComponentState, theirs: ComponentState): ComparisonVerdict {
  if (ours.kind === 'unknown' || theirs.kind === 'unknown') return 'not_specified'
  const oursHas = ours.kind === 'included' || ours.kind === 'allowance'
  const theirsHas = theirs.kind === 'included' || theirs.kind === 'allowance'
  if (oursHas && theirsHas) {
    const a = ours.kind === 'allowance' ? ours.detail : ours.detail
    const b = theirs.kind === 'allowance' ? theirs.detail : theirs.detail
    return a !== null && b !== null && a !== b ? 'differs' : 'both_include'
  }
  if (oursHas && !theirsHas) return 'we_include_they_do_not'
  if (!oursHas && theirsHas) return 'they_include_we_do_not'
  return 'both_exclude'
}

export function compareScopes(
  ours: NormalisedScope,
  theirs: NormalisedScope,
): readonly ComparisonRow[] {
  return ALL_COMPONENT_KEYS.map((key) => {
    const a = ours.components.get(key) ?? { kind: 'unknown' as const }
    const b = theirs.components.get(key) ?? { kind: 'unknown' as const }
    const verdict = verdictFor(a, b)
    return {
      key,
      label: SCOPE_COMPONENT_LABELS[key],
      ours: a,
      theirs: b,
      verdict,
      statement:
        verdict === 'not_specified'
          ? `${SCOPE_COMPONENT_LABELS[key]}: ours ${describe(a).toLowerCase()}, theirs ${describe(b).toLowerCase()}. Ask them to confirm.`
          : `${SCOPE_COMPONENT_LABELS[key]}: ${describe(a)} / ${describe(b)}.`,
    }
  })
}

export interface AttributedDifference {
  readonly key: ScopeComponentKey
  readonly label: string
  readonly amount: Cents
  /** Always states whose cost this is. It is ours; we do not know theirs. */
  readonly basis: string
}

export interface GapAnalysis {
  readonly ourTotal: Cents
  readonly theirTotal: Cents
  /** Positive when we are dearer, which is the case worth explaining. */
  readonly gap: Cents
  readonly attributed: readonly AttributedDifference[]
  readonly explained: Cents
  /** Gap left over once documented differences are accounted for. */
  readonly unexplained: Cents
  /** Components neither side's document settles. Never counted as explained. */
  readonly notSpecified: readonly ScopeComponentKey[]
  /** What a rep may fairly say. Deliberately hedged where the facts are. */
  readonly summary: string
}

/**
 * Attribute the price gap to documented scope differences.
 *
 * `ourComponentCost` supplies Delta Ridge's own cost for a component. Only
 * components we include and they explicitly exclude are attributed; a
 * component neither document settles goes to `notSpecified` and is reported
 * separately, because counting it would be inventing a difference.
 *
 * The unexplained remainder is reported honestly, including when it is large.
 * A tool that always manages to explain the whole gap is a tool nobody should
 * trust in front of a homeowner.
 */
export function analyseGap(
  ours: NormalisedScope,
  theirs: NormalisedScope,
  ourComponentCost: (key: ScopeComponentKey) => Cents | null,
): GapAnalysis | null {
  if (ours.total === null || theirs.total === null) return null

  const rows = compareScopes(ours, theirs)
  const attributed: AttributedDifference[] = []
  const notSpecified: ScopeComponentKey[] = []

  for (const row of rows) {
    if (row.verdict === 'not_specified') {
      notSpecified.push(row.key)
      continue
    }
    if (row.verdict !== 'we_include_they_do_not') continue
    const amount = ourComponentCost(row.key)
    if (amount === null || amount === 0) continue
    attributed.push({
      key: row.key,
      label: row.label,
      amount,
      basis: `Delta Ridge cost for ${row.label.toLowerCase()}; the other proposal's price for it is not known.`,
    })
  }

  const gap = cents(ours.total - theirs.total)
  const explained = sumCents(attributed.map((a) => a.amount))
  const unexplained = cents(gap - explained)

  return {
    ourTotal: ours.total,
    theirTotal: theirs.total,
    gap,
    attributed,
    explained,
    unexplained,
    notSpecified,
    summary: summarise(gap, explained, unexplained, notSpecified.length),
  }
}

function money(value: Cents): string {
  return `$${(Math.abs(value) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function summarise(
  gap: Cents,
  explained: Cents,
  unexplained: Cents,
  notSpecifiedCount: number,
): string {
  if (gap <= 0) {
    return `Delta Ridge is ${money(gap)} lower. There is no gap to explain.`
  }
  const tail =
    notSpecifiedCount > 0
      ? ` ${notSpecifiedCount} item(s) are not specified on one of the two documents and are not counted either way - ask for them in writing.`
      : ''
  if (explained === 0) {
    return `Delta Ridge is ${money(gap)} higher and none of it is explained by a documented scope difference yet.${tail}`
  }
  if (unexplained <= 0) {
    return `Delta Ridge is ${money(gap)} higher, and ${money(explained)} of documented scope difference more than accounts for it.${tail}`
  }
  return `Delta Ridge is ${money(gap)} higher. ${money(explained)} is explained by documented scope differences; ${money(unexplained)} is not.${tail}`
}

/**
 * The like-for-like number: their price plus our cost for what we carry and
 * they explicitly do not. Null when either total is missing.
 *
 * This is an estimate of what THEIR scope would cost if it matched ours, built
 * from OUR costs, and every caller must label it that way. It is not a claim
 * about what they would have charged.
 */
export function likeForLikeTotal(analysis: GapAnalysis | null): Cents | null {
  if (analysis === null) return null
  return cents(analysis.theirTotal + analysis.explained)
}
