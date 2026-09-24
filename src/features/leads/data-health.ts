export type HealthSeverity = 'blocker' | 'review' | 'warning'

export type FixTarget =
  | 'contact'
  | 'property'
  | 'permission'
  | 'timeline'
  | 'roofr'
  | 'sync'

export interface DataHealthIssue {
  key: string
  severity: HealthSeverity
  title: string
  detail: string
  target: FixTarget
}

export interface DataHealthEvidence {
  localContactName: string | null
  recordedOwnerName: string | null
  confirmedPhones: readonly string[]
  candidatePhones: readonly string[]
  wrongOrDisconnectedPhones: number
  doNotContactPhones: number
  localOptedOut: boolean
  permitRoofAgeYears: number | null
  homeownerStatedRoofAgeYears: number | null
  stormEvidenceCount: number
  imageryCapturedAt: string | null
  roofrJobId: string | null
  roofrLastEventAt: string | null
  pendingSyncItems: number
  failedSyncItems: number
  now: string
}

function normName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function namesClearlyDiffer(a: string, b: string): boolean {
  const left = normName(a)
  const right = normName(b)
  if (!left || !right) return false
  if (left === right || left.includes(right) || right.includes(left)) return false

  const leftParts = new Set(left.split(' ').filter((part) => part.length > 1))
  const rightParts = right.split(' ').filter((part) => part.length > 1)
  const overlap = rightParts.filter((part) => leftParts.has(part)).length

  // One shared surname/token is enough to avoid calling this a contradiction.
  // Married couples, trusts and assessor formatting make names noisy.
  return overlap === 0
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.floor((to - from) / 86_400_000)
}

/**
 * Contradictions and actionable gaps only.
 *
 * This intentionally does not pick a winner. A parcel owner and a homeowner
 * statement can disagree for legitimate reasons. The app surfaces the conflict
 * and lets a person resolve it with evidence.
 */
export function dataHealthIssues(e: DataHealthEvidence): DataHealthIssue[] {
  const issues: DataHealthIssue[] = []

  if (
    e.localContactName &&
    e.recordedOwnerName &&
    namesClearlyDiffer(e.localContactName, e.recordedOwnerName)
  ) {
    issues.push({
      key: 'owner-name-conflict',
      severity: 'review',
      title: 'Owner identity needs review',
      detail: `Lead contact is “${e.localContactName}” while the parcel record names “${e.recordedOwnerName}”. Do not silently overwrite either one.`,
      target: 'contact',
    })
  }

  if (e.confirmedPhones.length > 1) {
    issues.push({
      key: 'multiple-confirmed-phones',
      severity: 'review',
      title: 'Multiple confirmed phone numbers',
      detail: `${e.confirmedPhones.length} different phone numbers are marked confirmed. Pick the preferred number only after reviewing the contact history.`,
      target: 'contact',
    })
  } else if (e.confirmedPhones.length === 0 && e.candidatePhones.length > 0) {
    issues.push({
      key: 'unconfirmed-phone-candidates',
      severity: 'warning',
      title: 'Phone candidates are not confirmed',
      detail: `${e.candidatePhones.length} number${e.candidatePhones.length === 1 ? '' : 's'} on the canonical record still need human confirmation.`,
      target: 'contact',
    })
  }

  if (e.wrongOrDisconnectedPhones > 0) {
    issues.push({
      key: 'dead-phone-records',
      severity: 'warning',
      title: 'Contact records need cleanup',
      detail: `${e.wrongOrDisconnectedPhones} phone record${e.wrongOrDisconnectedPhones === 1 ? '' : 's'} are marked wrong or disconnected. Keep them for audit history, but do not reuse them.`,
      target: 'contact',
    })
  }

  if (e.doNotContactPhones > 0 || e.localOptedOut) {
    issues.push({
      key: 'contact-suppression',
      severity: 'blocker',
      title: 'Do not contact restriction',
      detail: 'A do-not-contact or opt-out record exists. This restriction must not be overridden by a provider refresh or a new phone candidate.',
      target: 'permission',
    })
  }

  if (
    e.permitRoofAgeYears !== null &&
    e.homeownerStatedRoofAgeYears !== null &&
    Math.abs(e.permitRoofAgeYears - e.homeownerStatedRoofAgeYears) >= 5
  ) {
    issues.push({
      key: 'roof-age-conflict',
      severity: 'review',
      title: 'Roof age sources disagree',
      detail: `Permit-derived age is about ${e.permitRoofAgeYears} years; the homeowner stated about ${e.homeownerStatedRoofAgeYears}. Keep both sources until a stronger record resolves the difference.`,
      target: 'property',
    })
  }

  if (e.stormEvidenceCount === 0) {
    issues.push({
      key: 'storm-evidence-gap',
      severity: 'warning',
      title: 'No property storm evidence attached',
      detail: 'No qualifying storm event is currently attached to this property record. Do not describe the roof as storm-affected from this lead alone.',
      target: 'property',
    })
  }

  if (e.imageryCapturedAt === null) {
    issues.push({
      key: 'imagery-gap',
      severity: 'warning',
      title: 'Current-condition imagery not established',
      detail: 'There is no dated aerial/current-condition image on this Lead 360 record. Remote roof-condition conclusions should remain limited.',
      target: 'property',
    })
  }

  if (e.failedSyncItems > 0) {
    issues.push({
      key: 'sync-failed',
      severity: 'blocker',
      title: 'Sync has stalled work',
      detail: `${e.failedSyncItems} queued item${e.failedSyncItems === 1 ? '' : 's'} stopped retrying and need attention.`,
      target: 'sync',
    })
  } else if (e.pendingSyncItems > 0) {
    issues.push({
      key: 'sync-pending',
      severity: 'warning',
      title: 'Work is still waiting to sync',
      detail: `${e.pendingSyncItems} queued item${e.pendingSyncItems === 1 ? '' : 's'} have not yet been acknowledged by the server.`,
      target: 'sync',
    })
  }

  if (e.roofrJobId !== null && e.roofrLastEventAt !== null) {
    const age = daysBetween(e.roofrLastEventAt, e.now)
    if (age !== null && age > 14) {
      issues.push({
        key: 'roofr-stale',
        severity: 'warning',
        title: 'Roofr link is quiet',
        detail: `Roofr job ${e.roofrJobId} has not produced an event in ${age} days. Review the integration before assuming its stage is current.`,
        target: 'roofr',
      })
    }
  }

  const rank: Record<HealthSeverity, number> = { blocker: 0, review: 1, warning: 2 }
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity])
}
