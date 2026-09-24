/**
 * Whether there is a legitimate basis to go back to a carrier.
 *
 * The output is deliberately not a prediction. "We will reopen it and win" is
 * the sentence this module exists to prevent a rep from saying — reopening is
 * the carrier's decision, appraisal is a policy process with its own clock, and
 * a contractor who promises either is promising something they do not control.
 *
 * What the checklist CAN honestly say is whether the ingredients of a request
 * are present: a policy in force on the reported date of loss, a claim young
 * enough to still be actionable, evidence that did not exist the first time,
 * and unrepaired damage. Those are facts about a file, not forecasts about a
 * decision.
 *
 * ONE RULE ABOVE ALL THE OTHERS
 *
 * The date of loss is whatever the homeowner reported. It is never adjusted to
 * fit a policy period, never nudged to the nearest storm, never "clarified"
 * into a better answer. If the reported date falls outside every policy period
 * on file, the honest output is that it does — and that is a matter for the
 * homeowner and their carrier, not something to be tidied away by software.
 */

export interface PolicyPeriod {
  readonly carrier: string
  readonly from: string
  /** Null means still in force. */
  readonly until: string | null
}

export interface PriorClaim {
  /** As the HOMEOWNER reported it. Never adjusted to fit anything. */
  readonly reportedDateOfLoss: string
  readonly carrier: string | null
  readonly closedAt: string | null
  readonly paidCents: number | null
  /** What the contractor's own scope came to, if one exists. */
  readonly contractorScopeCents: number | null
  readonly repairsCompleted: boolean | null
  readonly documentsOnFile: number
}

export interface NewEvidence {
  /** Imagery captured after the claim closed. */
  readonly postClosureImagery: boolean
  /** A measurement report the first estimate did not have. */
  readonly measurementReport: boolean
  /** Findings from an inspection done since. */
  readonly inspectionFindings: boolean
  /** Storm evidence that was not in the original file. */
  readonly stormEvidence: boolean
}

export type ReopenBasis =
  /** Enough is present to justify asking. */
  | 'potential_review'
  /** Something is there, but thin. */
  | 'weak_basis'
  /** The question is beyond what a contractor should be answering. */
  | 'specialist_review'
  /** Nothing supports going back. */
  | 'no_basis'

export interface ReopenAssessment {
  readonly basis: ReopenBasis
  /** Which policy appears to have been in force. Null when none matches. */
  readonly policyInForce: PolicyPeriod | null
  /** Every check, with its answer, for the drill-down. */
  readonly checks: readonly { readonly label: string; readonly met: boolean; readonly detail: string }[]
  /** What to say. Never a promise about the outcome. */
  readonly sentence: string
  /** Questions for the carrier, not assertions to it. */
  readonly questions: readonly string[]
}

/**
 * Which policy was in force on the date the homeowner reported.
 *
 * Returns null rather than the nearest policy when nothing covers the date.
 * "Nearest" would quietly answer a question nobody asked and would be the first
 * step toward moving the date to match.
 */
export function policyOn(periods: readonly PolicyPeriod[], dateOfLoss: string): PolicyPeriod | null {
  const loss = new Date(dateOfLoss).getTime()
  if (Number.isNaN(loss)) return null
  return (
    periods.find((period) => {
      const from = new Date(period.from).getTime()
      const until = period.until === null ? Number.POSITIVE_INFINITY : new Date(period.until).getTime()
      return !Number.isNaN(from) && loss >= from && loss <= until
    }) ?? null
  )
}

function monthsBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return (to - from) / (1000 * 60 * 60 * 24 * 30.44)
}

export function assessReopen(
  claim: PriorClaim,
  periods: readonly PolicyPeriod[],
  evidence: NewEvidence,
  now: string,
): ReopenAssessment {
  const policyInForce = policyOn(periods, claim.reportedDateOfLoss)

  const newEvidenceCount = [
    evidence.postClosureImagery,
    evidence.measurementReport,
    evidence.inspectionFindings,
    evidence.stormEvidence,
  ].filter(Boolean).length

  const ageMonths = claim.closedAt === null ? null : monthsBetween(claim.closedAt, now)
  const unrepaired = claim.repairsCompleted === false
  const scopeGap =
    claim.contractorScopeCents !== null && claim.paidCents !== null
      ? claim.contractorScopeCents - claim.paidCents
      : null

  const checks = [
    {
      label: 'A policy was in force on the reported date of loss',
      met: policyInForce !== null,
      detail:
        policyInForce !== null
          ? `${policyInForce.carrier}, from ${policyInForce.from}`
          : 'No policy on file covers the date the homeowner reported.',
    },
    {
      label: 'Evidence exists that the original file did not have',
      met: newEvidenceCount > 0,
      detail: `${newEvidenceCount} of 4 kinds of new evidence.`,
    },
    {
      label: 'The damage has not been repaired',
      met: unrepaired,
      detail:
        claim.repairsCompleted === null
          ? 'Nobody has recorded whether repairs were done.'
          : claim.repairsCompleted
            ? 'Repairs were completed, so there is nothing left to inspect.'
            : 'Repairs were not completed.',
    },
    {
      label: 'The claim is recent enough to still be actionable',
      met: ageMonths !== null && ageMonths <= 24,
      detail:
        ageMonths === null
          ? 'No closure date on file.'
          : `Closed about ${Math.round(ageMonths)} months ago.`,
    },
    {
      label: 'The contractor scope exceeds what was paid',
      met: scopeGap !== null && scopeGap > 0,
      detail:
        scopeGap === null
          ? 'No scope or no payment figure on file to compare.'
          : scopeGap > 0
            ? `Scope exceeds payment by $${(scopeGap / 100).toLocaleString('en-US')}.`
            : 'Payment met or exceeded the scope on file.',
    },
  ]

  const met = checks.filter((c) => c.met).length

  /*
   * No policy covering the reported date is the one answer that is not a
   * question of strength. It is beyond what a contractor should be resolving —
   * a coverage question turning on a policy this company has not read — so it
   * routes to somebody qualified rather than being scored.
   */
  if (policyInForce === null) {
    return {
      basis: 'specialist_review',
      policyInForce: null,
      checks,
      sentence:
        'None of the policy periods on file covers the date of loss the homeowner reported. ' +
        'That is a question for the homeowner and their carrier, or a public adjuster — ' +
        'and the reported date does not get changed to fit a policy.',
      questions: [
        'Which carrier was on the risk on the reported date of loss?',
        'Is there a policy period not yet on file?',
      ],
    }
  }

  if (claim.repairsCompleted === true && newEvidenceCount === 0) {
    return {
      basis: 'no_basis',
      policyInForce,
      checks,
      sentence:
        'The repairs were completed and there is nothing new since the claim closed. ' +
        'There is no basis to go back to the carrier on this one.',
      questions: [],
    }
  }

  const questions: string[] = []
  if (scopeGap !== null && scopeGap > 0) {
    questions.push('How was the roof area in the original estimate measured?')
    questions.push('Which line items in the contractor scope were excluded, and on what basis?')
  }
  if (evidence.measurementReport) {
    questions.push('Would the carrier review a professional measurement report against the original estimate?')
  }
  if (evidence.postClosureImagery || evidence.inspectionFindings) {
    questions.push('Would the carrier consider a reinspection in light of findings documented since?')
  }
  if (unrepaired) {
    questions.push('The damage is still in place and can be inspected — is a reinspection available?')
  }

  if (met >= 4) {
    return {
      basis: 'potential_review',
      policyInForce,
      checks,
      sentence:
        'There is a documented basis to ask the carrier for a review. Whether they reopen it is ' +
        'their decision — what we can do is put the evidence and the questions in front of them.',
      questions,
    }
  }

  return {
    basis: 'weak_basis',
    policyInForce,
    checks,
    sentence:
      'There is something here, but not much. The checklist below shows what is missing; ' +
      'filling those gaps would make a request worth making.',
    questions,
  }
}
