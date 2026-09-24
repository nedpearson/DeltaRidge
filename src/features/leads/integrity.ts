/**
 * What is actually established about this lead, and what is only claimed.
 *
 * The rule this module exists to enforce, stated once: no line here says
 * "verified" unless a specific artefact exists that a person could go and look
 * at. Not "we called the API and it answered" — an answer of "no match" is an
 * answer. Not "the field is populated" — a rep can type anything into a field.
 * Every `established` state below names the evidence that earned it, and that
 * evidence is passed in rather than inferred, so there is no path by which a
 * check turns green because a variable happened to be truthy.
 *
 * DELIBERATELY NOT A PERCENTAGE.
 *
 * The obvious presentation is a record-health score: 94%, a bar, a colour. It
 * is the wrong instrument and it fails on its own terms. A percentage needs
 * weights, and the weights would be invented — is a confirmed phone number
 * worth more than 18-day-old imagery? — so the number would carry a precision
 * nobody can defend, on a scale where 94% and 88% mean nothing different to
 * anyone. Worse, it averages: a lead with every box ticked except that the
 * homeowner is on the Do Not Call registry scores in the nineties, and the one
 * fact that changes what the rep may legally do is rounded into a rounding
 * error.
 *
 * So this returns a list and a count. Counting is defensible. Ranking is not.
 */

export type CheckState =
  /** An artefact exists. The `basis` names it. */
  | 'established'
  /** Somebody stated it. True or not, nothing has confirmed it. */
  | 'reported'
  /** We have it, and it is old enough that it may no longer be true. */
  | 'stale'
  /** We have nothing. Not a fault — most leads start here. */
  | 'absent'
  /** Something is wrong and a person needs to look. */
  | 'attention'

export interface IntegrityCheck {
  readonly key: string
  readonly label: string
  readonly state: CheckState
  /** What earned this state, in words a rep would say. Never a field name. */
  readonly basis: string
}

/**
 * The evidence the panel is allowed to reason from.
 *
 * Every field is the artefact itself or its absence — a date, an id, a count, a
 * named source — never a pre-computed verdict. A caller cannot pass
 * `phoneVerified: true` because there is no such parameter; it has to say where
 * the number came from and let this module decide what that is worth.
 */
export interface IntegrityEvidence {
  readonly address: string | null
  /** Where the phone number came from, or null if there is no number. */
  readonly phoneSource: string | null
  readonly hasEmail: boolean
  /** Whether a human said yes, and to what. Absence is not refusal, it is silence. */
  readonly callConsentAt: string | null
  readonly smsConsentAt: string | null
  /** Ids of compliance rules that cleared or blocked a call. Empty means nothing was consulted. */
  readonly callWindowRuleIds: readonly string[]
  readonly optedOut: boolean
  /** When the storm that put this address on the list was recorded, and by whom. */
  readonly stormSource: string | null
  readonly stormEventAt: string | null
  /** When the aerial imagery on file was captured, not when it was fetched. */
  readonly imageryCapturedAt: string | null
  /** Knocks with a GPS fix good enough to place the rep at the door. */
  readonly gpsVerifiedKnocks: number
  readonly totalKnocks: number
  readonly voiceNotes: number
  readonly voiceNotesTranscribed: number
  /** Roofr's job id, which only exists because Roofr sent it. */
  readonly roofrJobId: string | null
  readonly roofrLastEventAt: string | null
  /** Items still queued on this device, and items that gave up. */
  readonly pendingSyncItems: number
  readonly failedSyncItems: number
  readonly now: string
}

/** Aerial imagery older than this is quoted with its age rather than presented as current. */
export const IMAGERY_STALE_DAYS = 120

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.floor((to - from) / 86_400_000)
}

function agePhrase(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 45) return `${days} days ago`
  const months = Math.round(days / 30)
  return `${months} months ago`
}

const FROM_THE_HOMEOWNER = new Set([
  'homeowner_at_door',
  'homeowner_by_phone',
  'homeowner_in_writing',
])

export function integrityChecks(evidence: IntegrityEvidence): IntegrityCheck[] {
  const checks: IntegrityCheck[] = []

  checks.push(
    evidence.address !== null && evidence.address.trim() !== ''
      ? { key: 'address', label: 'Property', state: 'established', basis: 'On the parcel list' }
      : { key: 'address', label: 'Property', state: 'attention', basis: 'No address on this lead' },
  )

  // A phone number is never "verified" here. The only thing this app can
  // witness is where it came from, and that is what decides whether it may be
  // dialled — so that is what the line reports.
  if (evidence.phoneSource === null) {
    checks.push({ key: 'phone', label: 'Phone', state: 'absent', basis: 'No number yet' })
  } else if (FROM_THE_HOMEOWNER.has(evidence.phoneSource)) {
    checks.push({
      key: 'phone',
      label: 'Phone',
      state: 'established',
      basis: 'Given by the homeowner',
    })
  } else {
    checks.push({
      key: 'phone',
      label: 'Phone',
      state: 'reported',
      basis: 'From a lookup, not from the homeowner — cannot be dialled',
    })
  }

  checks.push(
    evidence.hasEmail
      ? { key: 'email', label: 'Email', state: 'reported', basis: 'On file, never confirmed' }
      : { key: 'email', label: 'Email', state: 'absent', basis: 'No address yet' },
  )

  // Permission is the check most worth getting right, so it is never averaged
  // away: an opt-out is `attention` no matter how complete everything else is.
  if (evidence.optedOut) {
    checks.push({
      key: 'permission',
      label: 'Permission',
      state: 'attention',
      basis: 'This homeowner has opted out. Do not contact.',
    })
  } else if (evidence.callWindowRuleIds.length === 0) {
    checks.push({
      key: 'permission',
      label: 'Permission',
      state: 'attention',
      basis: 'No rule has cleared this call',
    })
  } else if (evidence.callConsentAt !== null || evidence.smsConsentAt !== null) {
    const both = evidence.callConsentAt !== null && evidence.smsConsentAt !== null
    checks.push({
      key: 'permission',
      label: 'Permission',
      state: 'established',
      basis: both ? 'Agreed to calls and texts' : 'Agreed at the door',
    })
  } else {
    checks.push({
      key: 'permission',
      label: 'Permission',
      state: 'absent',
      basis: 'Nobody has agreed to be contacted',
    })
  }

  checks.push(
    evidence.stormSource !== null && evidence.stormEventAt !== null
      ? {
          key: 'storm',
          label: 'Storm',
          state: 'established',
          basis: `${evidence.stormSource}, ${agePhrase(daysBetween(evidence.stormEventAt, evidence.now) ?? 0)}`,
        }
      : { key: 'storm', label: 'Storm', state: 'absent', basis: 'No storm on record here' },
  )

  // Imagery is the clearest case for the stale state. A green "satellite
  // connected" beside a picture taken before the hail is worse than no line at
  // all, because it invites an AI finding and a sales conversation about a roof
  // nobody has actually looked at since.
  if (evidence.imageryCapturedAt === null) {
    checks.push({ key: 'imagery', label: 'Aerial imagery', state: 'absent', basis: 'None on file' })
  } else {
    const age = daysBetween(evidence.imageryCapturedAt, evidence.now)
    if (age === null) {
      checks.push({
        key: 'imagery',
        label: 'Aerial imagery',
        state: 'attention',
        basis: 'Capture date is unreadable',
      })
    } else {
      checks.push({
        key: 'imagery',
        label: 'Aerial imagery',
        state: age > IMAGERY_STALE_DAYS ? 'stale' : 'established',
        basis: `Captured ${agePhrase(age)}`,
      })
    }
  }

  if (evidence.totalKnocks === 0) {
    checks.push({ key: 'visits', label: 'Door activity', state: 'absent', basis: 'Not knocked yet' })
  } else if (evidence.gpsVerifiedKnocks === 0) {
    // Recorded, but nothing places the rep at the door. Said plainly and
    // without accusation: a dead GPS in a truck is the ordinary explanation.
    checks.push({
      key: 'visits',
      label: 'Door activity',
      state: 'reported',
      basis: `${evidence.totalKnocks} recorded, none with a GPS fix`,
    })
  } else {
    checks.push({
      key: 'visits',
      label: 'Door activity',
      state: 'established',
      basis: `${evidence.gpsVerifiedKnocks} of ${evidence.totalKnocks} placed by GPS`,
    })
  }

  if (evidence.voiceNotes === 0) {
    checks.push({ key: 'voice', label: 'Voice notes', state: 'absent', basis: 'None recorded' })
  } else if (evidence.voiceNotesTranscribed < evidence.voiceNotes) {
    checks.push({
      key: 'voice',
      label: 'Voice notes',
      state: 'reported',
      basis: `${evidence.voiceNotes - evidence.voiceNotesTranscribed} still to transcribe`,
    })
  } else {
    checks.push({
      key: 'voice',
      label: 'Voice notes',
      state: 'established',
      basis: `${evidence.voiceNotes} transcribed`,
    })
  }

  // "Synced" means Roofr told us its job id. Not that we sent something.
  checks.push(
    evidence.roofrJobId !== null
      ? {
          key: 'roofr',
          label: 'Roofr',
          state: 'established',
          basis:
            evidence.roofrLastEventAt === null
              ? `Job ${evidence.roofrJobId}`
              : `Job ${evidence.roofrJobId}, last heard ${agePhrase(daysBetween(evidence.roofrLastEventAt, evidence.now) ?? 0)}`,
        }
      : { key: 'roofr', label: 'Roofr', state: 'absent', basis: 'Not sent to Roofr' },
  )

  if (evidence.failedSyncItems > 0) {
    checks.push({
      key: 'sync',
      label: 'Sync',
      state: 'attention',
      basis: `${evidence.failedSyncItems} item${evidence.failedSyncItems === 1 ? '' : 's'} gave up trying to reach the server`,
    })
  } else if (evidence.pendingSyncItems > 0) {
    checks.push({
      key: 'sync',
      label: 'Sync',
      state: 'reported',
      basis: `${evidence.pendingSyncItems} waiting to send`,
    })
  } else {
    checks.push({ key: 'sync', label: 'Sync', state: 'established', basis: 'Everything is on the server' })
  }

  return checks
}

export interface IntegritySummary {
  readonly established: number
  readonly total: number
  readonly needsAttention: number
  /** One sentence. Leads with the count, because the count is the honest part. */
  readonly sentence: string
}

/**
 * The headline, which is a count and not a grade.
 *
 * `needsAttention` is reported separately and first rather than folded into the
 * ratio, because one opted-out homeowner is not one-eleventh of a problem.
 */
export function summarise(checks: readonly IntegrityCheck[]): IntegritySummary {
  const established = checks.filter((c) => c.state === 'established').length
  const needsAttention = checks.filter((c) => c.state === 'attention').length
  const total = checks.length

  const sentence =
    needsAttention > 0
      ? `${needsAttention} thing${needsAttention === 1 ? '' : 's'} need${needsAttention === 1 ? 's' : ''} attention`
      : established === total
        ? 'Everything on this lead is established'
        : `${established} of ${total} established`

  return { established, total, needsAttention, sentence }
}
