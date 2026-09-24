import type { ComplianceRule } from './rules'

/**
 * Telephone solicitation rules, verified against official sources on 2026-09-24.
 *
 * Every row here was read at the url it names, on that date. Nothing is
 * recalled. This file exists because the compliance engine had eleven rules
 * about licences, permits, codes and contracts and none at all about picking up
 * the phone — which is the one thing in this business with a per-incident price
 * tag attached and a private right of action behind it.
 *
 * Two things a Louisiana roofer should know before reading further, both of
 * them counter-intuitive:
 *
 *   1. Louisiana is STRICTER than federal on when you may call. Federal allows
 *      8am to 9pm. The Louisiana Public Service Commission's order allows 8am
 *      to 8pm Monday to Saturday and NOTHING on Sunday or a legal holiday.
 *      A Sunday afternoon is prime door-knocking time and a prohibited calling
 *      time, and those two facts sit badly together.
 *
 *   2. A text message is a call. The TCPA's restrictions on automatic dialling
 *      and prerecorded voice reach wireless numbers, and the FCC and the courts
 *      have long treated SMS as within them.
 *
 * What is NOT here, deliberately: any rule that would let the app decide a
 * number is safe to dial. These rules constrain; they never clear. Consent
 * remains a thing a person said, recorded on the lead.
 */

const VERIFIED_ON = '2026-09-24'
const VERIFIER = 'Claude (Opus 5), read at source'

export const LOUISIANA_SOLICITATION_RULES: readonly ComplianceRule[] = [
  {
    id: 'la-dnc-calling-window',
    category: 'solicitation',
    appliesTo: [],
    state: 'LA',
    summary:
      'Louisiana permits telephonic solicitation only between 8:00 a.m. and 8:00 p.m., Monday through Saturday. No solicitation calls on Sundays or legal holidays.',
    effect: {
      kind: 'contact_restriction',
      channels: ['call', 'sms'],
      permittedFrom: '08:00',
      permittedUntil: '20:00',
      // Sunday. The federal rule has no weekday blackout at all, so this is the
      // binding constraint for anybody working a Louisiana weekend.
      blackoutWeekdays: [0],
      blackoutLegalHolidays: true,
      requires: [
        'number_not_on_louisiana_do_not_call_list',
        'number_not_on_national_do_not_call_registry',
      ],
    },
    effectiveFrom: '2005-01-18',
    effectiveUntil: null,
    source: {
      tier: 'state_agency',
      citation: 'LPSC General Order (Do Not Call Program), R-29617',
      url: 'https://lpsc.louisiana.gov/docs/DNC/DNCGeneralOrder.pdf',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'Read at the source: "No calls will be placed between the hours of 8:00 P.M. and 8:00 ' +
      'A.M. Monday through Saturday", and none on Sundays or legal holidays. The order also ' +
      'permits calls "to any person with whom the telephonic solicitor has an existing ' +
      'business relationship, or a prior business relationship that was terminated or lapsed ' +
      'within six (6) months" — a NARROWER window than the federal eighteen months, so the ' +
      'federal relationship exemption does not rescue a Louisiana call. effectiveFrom is the ' +
      'date on the earlier general order and is a conservative floor.',
  },
  {
    id: 'la-dnc-registration',
    category: 'solicitation',
    appliesTo: [],
    state: 'LA',
    summary:
      'A telephonic solicitor must register with the Louisiana Public Service Commission and pay the registration fee in order to subscribe to the state Do Not Call list.',
    effect: {
      kind: 'prohibit',
      conduct: [
        'solicit_by_phone_without_lpsc_registration',
        'call_number_on_louisiana_do_not_call_list',
      ],
    },
    effectiveFrom: '2005-01-18',
    effectiveUntil: null,
    source: {
      tier: 'state_agency',
      citation: 'LPSC General Order (Do Not Call Program), R-29617',
      url: 'https://lpsc.louisiana.gov/docs/DNC/DNCGeneralOrder.pdf',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'Penalties read at the source: up to $1,500 per violation against a subscriber under 65, ' +
      'up to $3,000 where the subscriber is 65 or older, and up to $10,000 for an unregistered ' +
      'solicitor violating the regulations. The registration is not optional paperwork — it is ' +
      'how you obtain the list you are required to screen against, so an unregistered caller ' +
      'is by construction calling numbers they have not checked.',
  },
]

export const FEDERAL_SOLICITATION_RULES: readonly ComplianceRule[] = [
  {
    id: 'fed-dnc-registry',
    category: 'solicitation',
    appliesTo: [],
    state: 'US',
    summary:
      'Telephone solicitation to a residential subscriber on the National Do Not Call Registry is prohibited, and no solicitation may be made before 8 a.m. or after 9 p.m. local time at the called party.',
    effect: {
      kind: 'contact_restriction',
      channels: ['call', 'sms'],
      permittedFrom: '08:00',
      permittedUntil: '21:00',
      blackoutWeekdays: [],
      blackoutLegalHolidays: false,
      requires: [
        'number_not_on_national_do_not_call_registry',
        'or_established_business_relationship',
        'or_prior_express_invitation_or_permission_in_writing',
      ],
    },
    effectiveFrom: '2003-10-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: '47 C.F.R. § 64.1200(c)',
      url: 'https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'Registration on the national registry is honoured "indefinitely, or until the ' +
      'registration is cancelled by the consumer or the telephone number is removed". The ' +
      'established business relationship at (f)(5) runs eighteen months from a purchase or ' +
      'transaction, or THREE months from an inquiry or application — a homeowner who asked a ' +
      'question at a door in March is out of the exemption by June. Louisiana’s own window ' +
      'is six months and its hours are tighter, so the Louisiana rule governs here.',
  },
  {
    id: 'fed-tcpa-written-consent',
    category: 'solicitation',
    appliesTo: [],
    state: 'US',
    summary:
      'A marketing call or text to a wireless number using an automatic dialing system or an artificial or prerecorded voice requires prior express written consent, signed, naming the number, and disclosing that consent is not a condition of purchase.',
    effect: {
      kind: 'prohibit',
      conduct: [
        'autodial_wireless_without_prior_express_written_consent',
        'prerecorded_marketing_call_without_prior_express_written_consent',
        'condition_purchase_on_marketing_consent',
      ],
    },
    effectiveFrom: '2013-10-16',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: '47 C.F.R. § 64.1200(a)(2), (f)(9)',
      url: 'https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'The definition at (f)(9) is exacting: "an agreement, in writing, bearing the signature ' +
      'of the person called that clearly authorizes the seller to deliver ... advertisements or ' +
      'telemarketing messages using an automatic telephone dialing system or an artificial or ' +
      'prerecorded voice, and the telephone number to which the signatory authorizes such ' +
      '... messages to be delivered", disclosing that signing authorises such calls and that ' +
      'the person need not sign as a condition of purchase. A verbal yes at a door does not ' +
      'meet it. Delta Ridge records verbal consent for one-at-a-time manual contact and has no ' +
      'autodialler; that is the reason it stays compliant, and it stops being true the day ' +
      'somebody wires a bulk texting service to this database.',
  },
  {
    id: 'fed-internal-dnc',
    category: 'solicitation',
    appliesTo: [],
    state: 'US',
    summary:
      'A seller making telephone solicitations must keep a written do-not-call policy, train the people making calls, record a do-not-call request within 10 business days, and honour it for 5 years.',
    effect: {
      kind: 'documentation_required',
      checklist: [
        {
          key: 'internal-dnc-policy',
          label: 'Written do-not-call policy, available on demand',
          requiresGeotag: false,
          stage: 'before',
        },
        {
          key: 'internal-dnc-training',
          label: 'Every person who calls is trained on the policy and the list',
          requiresGeotag: false,
          stage: 'before',
        },
        {
          key: 'internal-dnc-record',
          label: 'Opt-out recorded within 10 business days of the request',
          requiresGeotag: false,
          stage: 'during',
        },
        {
          key: 'internal-dnc-identify',
          label: 'Caller gives their name, the company, and a contact number or address',
          requiresGeotag: false,
          stage: 'during',
        },
      ],
    },
    effectiveFrom: '2003-10-01',
    effectiveUntil: null,
    source: {
      tier: 'statute',
      citation: '47 C.F.R. § 64.1200(d)',
      url: 'https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200',
      verifiedAt: VERIFIED_ON,
      verifiedBy: VERIFIER,
    },
    reviewIntervalMonths: 12,
    notes:
      'A do-not-call request must be honoured "for 5 years from the time the request is made". ' +
      'Delta Ridge’s opt-out is permanent on the lead and clears every consent at the same ' +
      'time, which exceeds the requirement — but the five-year floor is what matters if the ' +
      'record is ever rebuilt or migrated. Statutory damages for the provisions above are $500 ' +
      'per violation, trebled at the court’s discretion for a wilful or knowing violation ' +
      '(47 U.S.C. § 227(b)(3), (c)(5)).',
  },
]

export const ALL_SOLICITATION_RULES: readonly ComplianceRule[] = [
  ...LOUISIANA_SOLICITATION_RULES,
  ...FEDERAL_SOLICITATION_RULES,
]
