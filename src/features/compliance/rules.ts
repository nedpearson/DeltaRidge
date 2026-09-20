/**
 * Sourced, versioned compliance rules.
 *
 * The rule this module exists to enforce: nothing in Delta Ridge asserts a
 * legal, code, permit, licensing or programme requirement unless a row says
 * so, and every row carries where it came from, when it took effect and when
 * a human last checked it. A model's recollection of a statute is not a
 * source. "I am fairly sure Louisiana requires..." is how a contractor ends
 * up telling a homeowner something that stopped being true in January.
 *
 * Rules therefore have three states and only one of them is usable as-is:
 *
 *   verified              - checked against the official source, still current
 *   review_due            - was verified, but the review interval has lapsed
 *   requires_verification - we know the question, not the answer
 *
 * A review_due rule is NOT silently trusted and NOT silently dropped. It is
 * surfaced with its age, because a permit fee that was right in March is
 * probably still roughly right in September and is definitely worth a phone
 * call before it goes on a contract.
 */

export type RuleStatus = 'verified' | 'review_due' | 'requires_verification'

export type SourceTier =
  | 'statute'
  | 'state_agency'
  | 'ahj'
  | 'adopted_code'
  | 'manufacturer'
  | 'licensed_dataset'
  | 'quote'
  | 'secondary'

/** Lower ranks win a conflict. A blog never overrides a statute. */
export const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  statute: 1,
  state_agency: 2,
  ahj: 3,
  adopted_code: 4,
  manufacturer: 5,
  licensed_dataset: 6,
  quote: 7,
  secondary: 8,
}

export interface RuleSource {
  readonly tier: SourceTier
  /** The citation a person can look up: "La. R.S. 37:2156.4". */
  readonly citation: string
  readonly url: string
  /** ISO date a human last confirmed this against the source. */
  readonly verifiedAt: string
  readonly verifiedBy: string
}

export type RuleCategory =
  | 'licensing'
  | 'permit'
  | 'code'
  | 'contract_notice'
  | 'conduct'
  | 'incentive_programme'
  | 'documentation'

export interface DocumentationItem {
  readonly key: string
  readonly label: string
  readonly requiresGeotag: boolean
  readonly stage: 'before' | 'during' | 'after'
}

export type RuleEffect =
  | {
      readonly kind: 'require_license'
      readonly minimumProjectValueCents: number
      readonly acceptableClassifications: readonly string[]
    }
  /** Exact statutory text. Never paraphrased, never composed at the call site. */
  | {
      readonly kind: 'contract_notice'
      readonly minimumContractValueCents: number
      readonly appliesWhenPaidFromInsurance: boolean
      readonly noticeText: string
      readonly formatting: string
    }
  | { readonly kind: 'prohibit'; readonly conduct: readonly string[] }
  | {
      readonly kind: 'permit_required'
      readonly permitType: string
      readonly feeCents: number | null
      readonly feeBasis: string | null
    }
  | {
      readonly kind: 'documentation_required'
      readonly checklist: readonly DocumentationItem[]
    }
  | { readonly kind: 'code_adoption'; readonly codes: readonly string[] }
  | {
      readonly kind: 'incentive'
      readonly programme: string
      readonly maximumGrantCents: number | null
      readonly eligibleAreas: readonly string[]
      /** What must never be dropped when this is shown to a homeowner. */
      readonly qualifier: string
    }

export interface ComplianceRule {
  readonly id: string
  readonly category: RuleCategory
  /** Empty means statewide. Otherwise parish or municipality names. */
  readonly appliesTo: readonly string[]
  readonly state: string
  readonly summary: string
  readonly effect: RuleEffect
  readonly effectiveFrom: string
  readonly effectiveUntil: string | null
  /** Null means nobody has verified this yet. The rule is a question. */
  readonly source: RuleSource | null
  readonly reviewIntervalMonths: number
  readonly notes: string | null
}
