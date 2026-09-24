import {
  SOURCE_TIER_RANK,
  type ComplianceRule,
  type DocumentationItem,
  type RuleStatus,
} from './rules'

/** Where the work is. Parish is what matters in Louisiana; city may refine it. */
export interface Jurisdiction {
  readonly state: string
  readonly parish: string
  readonly municipality: string | null
}

export interface RuleEvaluation {
  readonly rule: ComplianceRule
  readonly status: RuleStatus
  /** Months since last verification, or null when never verified. */
  readonly ageMonths: number | null
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from)
  const b = new Date(to)
  return (
    (b.getFullYear() - a.getFullYear()) * 12 +
    (b.getMonth() - a.getMonth()) -
    (b.getDate() < a.getDate() ? 1 : 0)
  )
}

export function statusOf(rule: ComplianceRule, asOf: string): RuleStatus {
  if (rule.source === null) return 'requires_verification'
  const age = monthsBetween(rule.source.verifiedAt, asOf)
  return age >= rule.reviewIntervalMonths ? 'review_due' : 'verified'
}

function inEffect(rule: ComplianceRule, asOf: string): boolean {
  if (rule.effectiveFrom > asOf) return false
  return rule.effectiveUntil === null || rule.effectiveUntil >= asOf
}

/**
 * `state: 'US'` means federal law, which applies in every state.
 *
 * Without this a federal rule sat in the table matching nothing — the engine
 * compared the state code literally, so a TCPA rule filed under 'US' was
 * invisible in Louisiana. Rules that are quietly never evaluated are the worst
 * kind to have, because the table looks complete.
 */
export const FEDERAL = 'US'

function appliesHere(rule: ComplianceRule, where: Jurisdiction): boolean {
  if (rule.state !== FEDERAL && rule.state !== where.state) return false
  if (rule.appliesTo.length === 0) return true
  const names = [where.parish, where.municipality].filter(
    (n): n is string => n !== null,
  )
  return rule.appliesTo.some((a) =>
    names.some((n) => n.toLowerCase() === a.toLowerCase()),
  )
}

/**
 * Rules that apply here and now, most authoritative first.
 *
 * Deliberately returns evaluations rather than rules: the caller must see the
 * status, because a rule nobody has checked in two years is not the same
 * thing as a rule verified last week and pretending otherwise is the whole
 * failure mode.
 */
export function rulesFor(
  all: readonly ComplianceRule[],
  where: Jurisdiction,
  asOf: string,
): readonly RuleEvaluation[] {
  return all
    .filter((r) => appliesHere(r, where) && inEffect(r, asOf))
    .map((rule) => ({
      rule,
      status: statusOf(rule, asOf),
      ageMonths: rule.source === null ? null : monthsBetween(rule.source.verifiedAt, asOf),
    }))
    .sort((a, b) => {
      const tierA = a.rule.source ? SOURCE_TIER_RANK[a.rule.source.tier] : 99
      const tierB = b.rule.source ? SOURCE_TIER_RANK[b.rule.source.tier] : 99
      if (tierA !== tierB) return tierA - tierB
      // A local rule is more specific than a statewide one, so it reads first
      // within a tier.
      return b.rule.appliesTo.length - a.rule.appliesTo.length
    })
}

export interface ComplianceCheckInput {
  readonly where: Jurisdiction
  readonly asOf: string
  readonly projectValueCents: number
  readonly paidFromInsuranceProceeds: boolean
  /** Classifications the organisation actually holds, from its own settings. */
  readonly heldLicenseClassifications: readonly string[]
  readonly licenseExpiresOn: string | null
}

export type ComplianceFinding =
  | {
      readonly kind: 'blocked'
      readonly ruleId: string
      readonly message: string
    }
  | {
      readonly kind: 'required_notice'
      readonly ruleId: string
      readonly noticeText: string
      readonly formatting: string
    }
  | {
      readonly kind: 'required_permit'
      readonly ruleId: string
      readonly permitType: string
      readonly feeCents: number | null
      readonly message: string
    }
  | {
      readonly kind: 'required_documentation'
      readonly ruleId: string
      readonly checklist: readonly DocumentationItem[]
    }
  | {
      readonly kind: 'needs_human_check'
      readonly ruleId: string
      readonly message: string
    }

/**
 * What must happen before this project can be contracted.
 *
 * Every finding names the rule it came from. There is no path through this
 * function that produces a requirement without a rule id, which is what makes
 * the output auditable rather than advisory.
 */
export function checkCompliance(
  all: readonly ComplianceRule[],
  input: ComplianceCheckInput,
): readonly ComplianceFinding[] {
  const findings: ComplianceFinding[] = []

  for (const { rule, status, ageMonths } of rulesFor(all, input.where, input.asOf)) {
    if (status === 'requires_verification') {
      findings.push({
        kind: 'needs_human_check',
        ruleId: rule.id,
        message: `${rule.summary} - not yet verified against an official source. Confirm with the authority before relying on it.`,
      })
      continue
    }

    const stale =
      status === 'review_due'
        ? ` Last verified ${ageMonths} month(s) ago - confirm before it goes on a contract.`
        : ''

    switch (rule.effect.kind) {
      case 'require_license': {
        if (input.projectValueCents < rule.effect.minimumProjectValueCents) break
        const held = input.heldLicenseClassifications.map((c) => c.toLowerCase())
        const ok = rule.effect.acceptableClassifications.some((c) =>
          held.includes(c.toLowerCase()),
        )
        if (!ok) {
          findings.push({
            kind: 'blocked',
            ruleId: rule.id,
            message: `${rule.summary} This project is above the threshold and the organisation does not hold one of: ${rule.effect.acceptableClassifications.join(', ')}.${stale}`,
          })
        } else if (
          input.licenseExpiresOn !== null &&
          input.licenseExpiresOn < input.asOf
        ) {
          findings.push({
            kind: 'blocked',
            ruleId: rule.id,
            message: `The licence on file expired on ${input.licenseExpiresOn}.${stale}`,
          })
        }
        break
      }

      case 'contract_notice': {
        if (rule.effect.appliesWhenPaidFromInsurance && !input.paidFromInsuranceProceeds) break
        if (input.projectValueCents < rule.effect.minimumContractValueCents) break
        findings.push({
          kind: 'required_notice',
          ruleId: rule.id,
          noticeText: rule.effect.noticeText,
          formatting: rule.effect.formatting,
        })
        break
      }

      case 'permit_required': {
        findings.push({
          kind: 'required_permit',
          ruleId: rule.id,
          permitType: rule.effect.permitType,
          feeCents: rule.effect.feeCents,
          message:
            rule.effect.feeCents === null
              ? `${rule.effect.permitType}: fee not on file - verify with the authority having jurisdiction.${stale}`
              : `${rule.effect.permitType}.${stale}`,
        })
        break
      }

      case 'documentation_required': {
        findings.push({
          kind: 'required_documentation',
          ruleId: rule.id,
          checklist: rule.effect.checklist,
        })
        break
      }

      case 'prohibit':
      case 'code_adoption':
      case 'incentive':
      case 'contact_restriction':
        // These constrain what the software may SAY, not what it must collect.
        // They are surfaced through the dedicated helpers below rather than as
        // findings, so a proposal screen cannot accidentally render a grant
        // programme as a requirement.
        break
    }

    if (status === 'review_due' && rule.effect.kind !== 'require_license') {
      findings.push({
        kind: 'needs_human_check',
        ruleId: rule.id,
        message: `${rule.summary} Last verified ${ageMonths} month(s) ago.`,
      })
    }
  }

  return findings
}

/** Conduct the software itself must never perform. */
export function prohibitedConduct(
  all: readonly ComplianceRule[],
  where: Jurisdiction,
  asOf: string,
): readonly string[] {
  const out = new Set<string>()
  for (const { rule, status } of rulesFor(all, where, asOf)) {
    if (status === 'requires_verification') continue
    if (rule.effect.kind === 'prohibit') {
      for (const c of rule.effect.conduct) out.add(c)
    }
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// When a homeowner may be telephoned
// ---------------------------------------------------------------------------

export interface CallWindowVerdict {
  readonly allowed: boolean
  /** Why not, in words a rep can act on. Empty when allowed. */
  readonly reasons: readonly string[]
  /** The rules that decided it, so the answer can be checked rather than trusted. */
  readonly ruleIds: readonly string[]
  /** What has to be true before a call may be placed at all, from every rule. */
  readonly requires: readonly string[]
}

const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  return h * 60 + min
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h >= 12 ? 'pm' : 'am'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${twelve}${suffix}` : `${twelve}:${String(m).padStart(2, '0')}${suffix}`
}

/**
 * Whether a solicitation call or text may be placed at this moment.
 *
 * EVERY applicable rule has to allow it. The tightest wins, which in Louisiana
 * means the state order rather than the federal one: 8pm rather than 9pm, and
 * nothing at all on a Sunday. A rep who has spent Sunday afternoon knocking is
 * the person most likely to reach for the phone at exactly the wrong moment,
 * which is the entire reason this is computed rather than written on a poster.
 *
 * `at` is the local wall-clock time at the called party. For this business the
 * rep and the homeowner are in the same parish, so the device clock is right —
 * and that assumption is stated here rather than buried, because it stops being
 * true the first time Delta Ridge calls somebody who has moved out of state.
 *
 * Legal holidays are NOT computed. A rule that blacks them out returns a
 * reminder to check, because a wrong holiday calendar is worse than none.
 */
export function mayCallAt(
  all: readonly ComplianceRule[],
  where: Jurisdiction,
  at: Date,
  asOf: string = at.toISOString().slice(0, 10),
): CallWindowVerdict {
  const reasons: string[] = []
  const ruleIds: string[] = []
  const requires = new Set<string>()

  const minutes = at.getHours() * 60 + at.getMinutes()
  const weekday = at.getDay()

  for (const { rule, status } of rulesFor(all, where, asOf)) {
    if (rule.effect.kind !== 'contact_restriction') continue
    // An unverified rule is a question, not a restriction. It is surfaced by
    // checkCompliance as something a human owes an answer to; it does not get
    // to block a call on a citation nobody has read.
    if (status === 'requires_verification') continue

    ruleIds.push(rule.id)
    for (const r of rule.effect.requires) requires.add(r)

    if (rule.effect.blackoutWeekdays.includes(weekday)) {
      reasons.push(`No solicitation calls on ${WEEKDAY_NAME[weekday]} (${rule.source?.citation ?? rule.id}).`)
      continue
    }

    const from = rule.effect.permittedFrom ? minutesOf(rule.effect.permittedFrom) : null
    const until = rule.effect.permittedUntil ? minutesOf(rule.effect.permittedUntil) : null

    if (from !== null && minutes < from) {
      reasons.push(`Too early — calls start at ${clock(from)} (${rule.source?.citation ?? rule.id}).`)
    } else if (until !== null && minutes >= until) {
      reasons.push(`Too late — calls stop at ${clock(until)} (${rule.source?.citation ?? rule.id}).`)
    }

    if (rule.effect.blackoutLegalHolidays) {
      requires.add('not_a_legal_holiday')
    }
  }

  // Nothing matched. A restriction engine that has no rules for a place must
  // not read as permission — "we have not loaded any telephone rules for this
  // jurisdiction" and "this call is fine" are opposite answers, and returning
  // the second for the first is how an engine gives its most confident wrong
  // answer in exactly the place it knows least about.
  if (ruleIds.length === 0) {
    return {
      allowed: false,
      reasons: [
        'No telephone solicitation rules are loaded for this place, so nothing has cleared this call.',
      ],
      ruleIds: [],
      requires: [],
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    ruleIds,
    requires: [...requires],
  }
}

export interface IncentiveOffer {
  readonly ruleId: string
  readonly programme: string
  readonly maximumGrantCents: number | null
  /** Never omitted when this is shown to a homeowner. */
  readonly qualifier: string
  readonly areaEligible: boolean
}

/**
 * Incentives are returned with `areaEligible` rather than filtered out, so a
 * rep can tell a homeowner in an ineligible parish that the programme exists
 * and this address is not in it - which is a far better conversation than
 * silence, and a far safer one than an implied promise.
 */
export function incentivesFor(
  all: readonly ComplianceRule[],
  where: Jurisdiction,
  asOf: string,
): readonly IncentiveOffer[] {
  const out: IncentiveOffer[] = []
  for (const { rule, status } of rulesFor(all, where, asOf)) {
    if (status === 'requires_verification') continue
    if (rule.effect.kind !== 'incentive') continue
    out.push({
      ruleId: rule.id,
      programme: rule.effect.programme,
      maximumGrantCents: rule.effect.maximumGrantCents,
      qualifier: rule.effect.qualifier,
      areaEligible: rule.effect.eligibleAreas.some(
        (a) => a.toLowerCase() === where.parish.toLowerCase(),
      ),
    })
  }
  return out
}

/** The photo checklist the AHJ requires, merged across applicable rules. */
export function documentationChecklist(
  all: readonly ComplianceRule[],
  where: Jurisdiction,
  asOf: string,
): readonly DocumentationItem[] {
  const byKey = new Map<string, DocumentationItem>()
  for (const { rule, status } of rulesFor(all, where, asOf)) {
    if (status === 'requires_verification') continue
    if (rule.effect.kind !== 'documentation_required') continue
    for (const item of rule.effect.checklist) byKey.set(item.key, item)
  }
  return [...byKey.values()]
}
