import type { ComplianceRule } from './rules'

/**
 * Louisiana rules verified against official sources on 2026-09-19.
 *
 * EVERY row here was read at its source on that date, and the url is the page
 * that was read. Nothing in this file is recalled, inferred or carried over
 * from a summary. Where the official source did not answer the question, the
 * rule exists with `source: null` so it surfaces as a question rather than
 * quietly not existing.
 *
 * This file is the seed. Once migration 0012 is applied these live in
 * `compliance_rules` and are maintained there; the seed exists so the app is
 * useful offline and so the initial rows are reviewable in a diff.
 */

const VERIFIED_ON = '2026-09-19'
const VERIFIER = 'claude+ned'

export const LOUISIANA_RULES: readonly ComplianceRule[] = [
  {
    id: 'la-license-residential-roofing',
    category: 'licensing',
    appliesTo: [],
    state: 'LA',
    summary:
      'Residential roofing work of $7,500 or more requires a Residential Roofing or Residential Construction licence.',
    effect: {
      kind: 'require_license',
      minimumProjectValueCents: 750_000,
      acceptableClassifications: ['Residential Roofing', 'Residential Construction'],
    },
    effectiveFrom: '2026-01-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: 'La. R.S. 37:2156.4 (2025 Act 422)',
      url: 'https://legis.la.gov/Legis/law.aspx?d=1431142',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 6,
    notes:
      'The statute also requires passing the residential roofing trade examination. ' +
      'Delta Ridge holds its classifications in organisation settings; this rule only ' +
      'compares against what is on file.',
  },
  {
    id: 'la-permit-roofing-statewide',
    category: 'permit',
    appliesTo: [],
    state: 'LA',
    summary:
      'Roof construction and reroofing on residential and commercial structures requires a permit and inspection.',
    effect: {
      kind: 'permit_required',
      permitType: 'Reroof permit',
      feeCents: null,
      feeBasis: null,
    },
    effectiveFrom: '2025-08-01',
    effectiveUntil: null,
    source: {
      tier: 'secondary',
      citation: '2025 Act 239, as summarised by Adams and Reese',
      url: 'https://www.adamsandreese.com/insights/louisiana-enacts-new-requirements-on-roofing-permits-and-licensing',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 3,
    notes:
      'SECONDARY SOURCE. The statutory text of Act 239 was not read directly, so this ' +
      'row should be upgraded to a statute citation before it is relied on in a dispute. ' +
      'Fee is null on purpose: it is set locally, not by the Act.',
  },
  {
    id: 'la-contract-notice-deductible',
    category: 'contract_notice',
    appliesTo: [],
    state: 'LA',
    summary:
      'A contract of $1,000 or more expected to be paid wholly or partly from property insurance proceeds must carry the statutory deductible notice.',
    effect: {
      kind: 'contract_notice',
      minimumContractValueCents: 100_000,
      appliesWhenPaidFromInsurance: true,
      // Verbatim statutory text. Never edit, shorten or "clarify" this string.
      noticeText:
        'Louisiana law requires a person insured under a property insurance policy to pay ' +
        'any deductible applicable to a claim made under the policy. It is a violation of ' +
        'Louisiana law for a seller of goods or services who reasonably expects to be paid ' +
        'wholly or partly from the proceeds of a property insurance claim to knowingly allow ' +
        'the insured person to fail to pay, or assist in the insured person’s failure to ' +
        'pay, the applicable insurance deductible.',
      formatting: 'At least 12-point boldfaced type, in the contract itself.',
    },
    effectiveFrom: '2010-01-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: 'La. R.S. 51:452',
      url: 'https://legis.la.gov/Legis/Law.aspx?d=104539',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'effectiveFrom is a conservative floor, not a verified enactment date - the notice ' +
      'requirement predates any contract this system will write, so the exact date does ' +
      'not change behaviour. The notice TEXT was read verbatim at the source.',
  },
]

export const LOUISIANA_RULES_PART_2: readonly ComplianceRule[] = [
  {
    id: 'la-prohibit-deductible-avoidance',
    category: 'conduct',
    appliesTo: [],
    state: 'LA',
    summary:
      'A seller may not pay, waive, absorb, rebate or otherwise decline to charge an insured’s property insurance deductible.',
    effect: {
      kind: 'prohibit',
      conduct: [
        'waive_deductible',
        'absorb_deductible',
        'rebate_offsetting_deductible',
        'decline_to_collect_deductible',
      ],
    },
    effectiveFrom: '2010-01-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: 'La. R.S. 51:451',
      url: 'https://www.legis.la.gov/legis/Law.aspx?d=104538',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'Penalty at the source: up to $500 or 30 days per offence, each offence a separate ' +
      'violation. A discount that reaches the same economic result is the thing to detect, ' +
      'not the word "waive".',
  },
  {
    id: 'la-prohibit-coverage-interpretation',
    category: 'conduct',
    appliesTo: [],
    state: 'LA',
    summary:
      'A contractor may not interpret insurance policy coverage, adjust a claim as a public adjuster, or solicit to do so; and may not obtain authorisation for insurance-funded repairs without first giving a good-faith itemised estimate.',
    effect: {
      kind: 'prohibit',
      conduct: [
        'interpret_policy_coverage',
        'act_as_public_adjuster',
        'solicit_public_adjusting',
        'authorise_repairs_without_itemised_estimate',
      ],
    },
    effectiveFrom: '2022-01-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: 'La. R.S. 37:2159.1',
      url: 'https://www.legis.la.gov/legis/Law.aspx?d=1297028',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'This is the rule that shapes the whole insurance mode: Delta Ridge documents its own ' +
      'construction scope and never says what a policy owes. The prohibitions extend to ' +
      'employees and to non-employees the contractor compensates. effectiveFrom is a ' +
      'conservative floor; the enactment date was not read at the source.',
  },
  {
    id: 'la-code-adoption',
    category: 'code',
    appliesTo: [],
    state: 'LA',
    summary:
      'The 2021 International Codes with Louisiana amendments, and the 2020 National Electrical Code with Louisiana amendments, apply to projects submitted on or after 1 January 2023.',
    effect: {
      kind: 'code_adoption',
      codes: [
        '2021 International Codes with Louisiana amendments',
        '2020 National Electrical Code with Louisiana amendments',
      ],
    },
    effectiveFrom: '2023-01-01',
    effectiveUntil: null,
    source: {
      tier: 'state_agency',
      citation: 'Louisiana State Uniform Construction Code Council',
      url: 'https://lsuccc.dps.louisiana.gov/',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 3,
    notes:
      'The Council page states "2021 International Codes" collectively and does not name the ' +
      'IRC edition individually, so no specific IRC section may be cited from this row. ' +
      'La. R.S. 40:1730.28 mandates adoption of the LATEST editions, which means the ' +
      'effective edition changes by Council action rather than by statute - hence the short ' +
      'review interval. Structural IBC changes take effect 2026-07-01 per 2024 Act 534.',
  },
]

/** The 25 parishes the Louisiana Fortify Homes Program covers. Note the absence. */
const LFHP_PARISHES: readonly string[] = [
  'Acadia', 'Ascension', 'Assumption', 'Calcasieu', 'Cameron', 'Iberia',
  'Iberville', 'Jefferson', 'Jefferson Davis', 'Lafayette', 'Lafourche',
  'Livingston', 'Orleans', 'Plaquemines', 'St. Bernard', 'St. Charles',
  'St. James', 'St. John the Baptist', 'St. Martin', 'St. Mary',
  'St. Tammany', 'Tangipahoa', 'Terrebonne', 'Vermilion', 'Washington',
]

export const LOUISIANA_RULES_PART_3: readonly ComplianceRule[] = [
  {
    id: 'la-lfhp-grant',
    category: 'incentive_programme',
    appliesTo: [],
    state: 'LA',
    summary:
      'Louisiana Fortify Homes Program: grants of up to $10,000 toward a FORTIFIED Roof designation, in 25 named parishes.',
    effect: {
      kind: 'incentive',
      programme: 'Louisiana Fortify Homes Program',
      maximumGrantCents: 1_000_000,
      eligibleAreas: LFHP_PARISHES,
      qualifier:
        'Grant funding is not guaranteed. As of 19 September 2026 lottery registration is ' +
        'closed and further rounds had not been announced. Eligibility also requires a ' +
        'homestead exemption, active wind coverage, and flood insurance where the home is ' +
        'in a FEMA special flood hazard area. The grant funds the FORTIFIED Roof standard ' +
        'only, not Silver or Gold.',
    },
    effectiveFrom: '2023-10-02',
    effectiveUntil: null,
    source: {
      tier: 'state_agency',
      citation: 'Louisiana Department of Insurance, Fortify Homes',
      url: 'https://ldi.la.gov/fortifyhomes',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 2,
    notes:
      'EAST BATON ROUGE IS NOT ON THE ELIGIBLE LIST. Ascension and Livingston are. This ' +
      'matters commercially: the grant cannot be part of a Baton Rouge pitch. Short review ' +
      'interval because grant rounds open and close.',
  },
  {
    id: 'la-fortified-premium-benchmarks',
    category: 'incentive_programme',
    appliesTo: [],
    state: 'LA',
    summary:
      'Benchmark FORTIFIED premium discounts, 16% to 49% of the HURRICANE PORTION of premium, mandatory for insurers no later than 1 January 2027.',
    effect: {
      kind: 'incentive',
      programme: 'FORTIFIED benchmark premium discounts',
      maximumGrantCents: null,
      eligibleAreas: [],
      qualifier:
        'The discount applies to the hurricane portion of the premium, not to the whole ' +
        'premium, and varies by zone and designation: Roof 16/27/29%, Silver 20/35/43%, ' +
        'Gold 24/42/49% for North/Central/South. It is a mandatory minimum for insurers ' +
        'from 1 January 2027, not a quote. Any figure shown to a homeowner must be ' +
        'labelled carrier- and zone-dependent unless their actual carrier has confirmed it.',
    },
    effectiveFrom: '2027-01-01',
    effectiveUntil: null,
    source: {
      tier: 'state_agency',
      citation: 'Louisiana Department of Insurance, Fortified Benchmarks (Regulation 136)',
      url: 'https://www.ldi.la.gov/fortifiedbenchmarks',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 3,
    notes:
      'eligibleAreas is empty because the benchmark is statewide by zone; the zone lookup ' +
      'itself is NOT yet built, so no per-address percentage may be quoted from this row. ' +
      'Not in effect until 2027-01-01, so rulesFor() will not return it before then.',
  },
]

export const PARISH_RULES: readonly ComplianceRule[] = [
  {
    id: 'ascension-reroof-photos',
    category: 'documentation',
    appliesTo: ['Ascension'],
    state: 'LA',
    summary:
      'Ascension Parish reroof permits are closed out on geo-tagged photographs of removal and installation, verified by the parish.',
    effect: {
      kind: 'documentation_required',
      checklist: [
        {
          key: 'existing_roof_before',
          label: 'Existing roof before removal',
          requiresGeotag: true,
          stage: 'before',
        },
        {
          key: 'removal_in_progress',
          label: 'Removal of roof and roof materials',
          requiresGeotag: true,
          stage: 'during',
        },
        {
          key: 'installation_in_progress',
          label: 'Installation of new roof and materials',
          requiresGeotag: true,
          stage: 'during',
        },
        {
          key: 'completed_roof',
          label: 'Completed reroof',
          requiresGeotag: true,
          stage: 'after',
        },
      ],
    },
    effectiveFrom: '2023-11-01',
    effectiveUntil: null,
    source: {
      tier: 'ahj',
      citation: 'Ascension Parish, Reroof Permitting Process',
      url: 'https://www.ascensionparish.net/wp-content/uploads/2023/11/REROOF-PERMITTING-PROCESS.pdf',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 6,
    notes:
      'Verbatim at the source: "Provide Geo-Tagged Photographs of Removal of Roof and Roof ' +
      'Materials and Installation Process of New Roof And Materials." Geo-tagged, not merely ' +
      'time-stamped. The parish verifies the photos and issues a Certificate of Completion, ' +
      'so a missing GPS fix is a schedule problem, not a paperwork problem. The four ' +
      'checklist stages are a reasonable reading of two named stages plus before/after; the ' +
      'source names removal and installation explicitly.',
  },
  {
    id: 'ebr-reroof-permit',
    category: 'permit',
    appliesTo: ['East Baton Rouge'],
    state: 'LA',
    summary: 'East Baton Rouge reroof permit requirements and fee.',
    effect: {
      kind: 'permit_required',
      permitType: 'EBR reroof permit',
      feeCents: null,
      feeBasis: null,
    },
    effectiveFrom: '2025-08-01',
    effectiveUntil: null,
    // Deliberately unverified. The parish page was not read at the source on
    // 2026-09-19, so this surfaces as a question rather than as a fact with a
    // fee nobody checked.
    source: null,
    reviewIntervalMonths: 3,
    notes:
      'REQUIRES VERIFICATION. Read the EBR permit office’s own reroof page and record the ' +
      'permit type, the fee basis and the current fee before this is used on a contract.',
  },
  {
    id: 'livingston-reroof-permit',
    category: 'permit',
    appliesTo: ['Livingston'],
    state: 'LA',
    summary: 'Livingston Parish residential roofing permit requirements and fee.',
    effect: {
      kind: 'permit_required',
      permitType: 'Livingston residential roofing permit',
      feeCents: null,
      feeBasis: null,
    },
    effectiveFrom: '2025-08-01',
    effectiveUntil: null,
    source: null,
    reviewIntervalMonths: 3,
    notes: 'REQUIRES VERIFICATION. Same as East Baton Rouge: read the parish source first.',
  },
]

export const ALL_LOUISIANA_RULES: readonly ComplianceRule[] = [
  ...LOUISIANA_RULES,
  ...LOUISIANA_RULES_PART_2,
  ...LOUISIANA_RULES_PART_3,
  ...PARISH_RULES,
]
