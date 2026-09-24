/**
 * Turning a Zapier POST into something we are willing to store.
 *
 * This file is deliberately free of Deno, Supabase and network code so the
 * decisions in it can be tested directly. Every one of them is a decision about
 * trust: what Zapier sends is a JSON object assembled by whoever configured the
 * Zap, mapped field by field from Roofr's trigger output, and it can arrive with
 * the right keys in the wrong types, the right types with the wrong meaning, or
 * a "$12,345.00" where a number was expected. Nothing here assumes otherwise.
 *
 * The governing rule for the whole integration: an event we cannot understand
 * is recorded as not understood. It is never coerced into the nearest thing
 * that would let processing continue, because an event silently filed under the
 * wrong lead is worse than one filed under none.
 */

/** The nine things Roofr can tell us, and nothing else. */
export type RoofrEventType =
  | 'lead_created'
  | 'report_ordered'
  | 'proposal_sent'
  | 'proposal_viewed'
  | 'proposal_signed'
  | 'proposal_lost'
  | 'proposal_total_adjusted'
  | 'workflow_stage_changed'
  /** Not a Roofr trigger. The outbound Zap's second step reporting back. */
  | 'job_created'

/**
 * Accepted spellings.
 *
 * Zapier's own labels are title case with spaces ("Proposal Signed"), a person
 * hand-building a Zap will type snake_case, and Roofr's payloads have used
 * dotted names. All three are the same event and all three are accepted; an
 * integration that breaks because somebody typed a capital letter is not an
 * integration, it is a trap.
 */
const EVENT_ALIASES: Readonly<Record<string, RoofrEventType>> = {
  lead_created: 'lead_created',
  'roofr lead created': 'lead_created',
  'lead created': 'lead_created',
  'lead.created': 'lead_created',

  report_ordered: 'report_ordered',
  'report ordered': 'report_ordered',
  'roofr report ordered': 'report_ordered',
  'report.ordered': 'report_ordered',

  proposal_sent: 'proposal_sent',
  'proposal sent': 'proposal_sent',
  'proposal.sent': 'proposal_sent',

  proposal_viewed: 'proposal_viewed',
  'proposal viewed': 'proposal_viewed',
  'proposal.viewed': 'proposal_viewed',

  proposal_signed: 'proposal_signed',
  'proposal signed': 'proposal_signed',
  'proposal.signed': 'proposal_signed',
  'proposal accepted': 'proposal_signed',

  proposal_lost: 'proposal_lost',
  'proposal lost': 'proposal_lost',
  'proposal.lost': 'proposal_lost',

  proposal_total_adjusted: 'proposal_total_adjusted',
  'proposal total adjusted': 'proposal_total_adjusted',
  'proposal.total.adjusted': 'proposal_total_adjusted',

  workflow_stage_changed: 'workflow_stage_changed',
  'job workflow stage changed': 'workflow_stage_changed',
  'workflow stage changed': 'workflow_stage_changed',
  'job.workflow.stage.changed': 'workflow_stage_changed',

  job_created: 'job_created',
  'job created': 'job_created',
  'job.created': 'job_created',
}

export function parseEventType(raw: unknown): RoofrEventType | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return EVENT_ALIASES[key] ?? null
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  // Roofr ids arrive as bare integers often enough to be worth handling, but
  // only when they are integers. A float id is a mapping mistake, not an id.
  if (typeof value === 'number' && Number.isInteger(value)) return String(value)
  return null
}

/** First non-empty string among several spellings of the same field. */
function pick(body: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const found = str(body[key])
    if (found !== null) return found
  }
  return null
}

/**
 * Money, without the rounding error.
 *
 * Roofr proposal totals arrive as "12,345.67", "$12,345.67", 12345.67 or
 * sometimes "12345". All of them are dollars, and all of them become integer
 * cents here, because `12345.67 * 100` is 1234566.9999999998 in binary floating
 * point and a proposal total that is a cent light on every third job is the
 * kind of bug nobody finds for a year.
 */
export function parseMoneyCents(value: unknown): number | null {
  if (value === null || value === undefined) return null

  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    text = value.toFixed(4)
  } else if (typeof value === 'string') {
    text = value.trim()
  } else {
    return null
  }

  if (text === '') return null

  const negative = /^\(.*\)$/.test(text) || text.startsWith('-')
  // Strip currency symbols, thousands separators and accounting parentheses.
  const cleaned = text.replace(/[()\s$,\u00a0]/g, '').replace(/^[-+]/, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null

  const [whole = '0', fraction = ''] = cleaned.split('.')
  const cents = `${fraction}00`.slice(0, 2)
  const total = Number(whole) * 100 + Number(cents)
  if (!Number.isSafeInteger(total)) return null

  // A negative proposal total is not a discount, it is a bad mapping. Refuse it
  // rather than store a number the estimator would later have to defend.
  return negative ? null : total
}

/**
 * A timestamp we are prepared to believe.
 *
 * Anything unparseable returns null and the row falls back to received_at,
 * which is a true statement about when WE learned of it. Inventing an
 * occurred_at from the clock would make an event look like it happened at the
 * moment of a Zapier retry, which is how a signed proposal ends up dated three
 * days late in a rep's activity timeline.
 */
export function parseInstant(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds or milliseconds; anything below this threshold is not a plausible
    // epoch-millisecond value for a roofing job.
    const ms = value < 1e11 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getUTCFullYear()
  // A 1970 timestamp is almost always a zero that travelled; a 2380 one is a
  // seconds/milliseconds mix-up. Neither is a roof.
  if (year < 2000 || year > 2100) return null
  return date.toISOString()
}

export interface NormalizedEvent {
  readonly providerEventId: string
  readonly eventType: RoofrEventType
  readonly occurredAt: string | null
  readonly roofrJobId: string | null
  readonly roofrCustomerId: string | null
  /** The id WE sent when creating the job, echoed back. */
  readonly externalJobId: string | null
  readonly workflowStage: string | null
  readonly proposalTotalCents: number | null
  readonly addressLine1: string | null
  readonly postalCode: string | null
}

export type NormalizeResult =
  | { readonly ok: true; readonly event: NormalizedEvent }
  | { readonly ok: false; readonly reason: string }

/**
 * The idempotency key, and why one is synthesised when Zapier does not send one.
 *
 * Zapier retries failed steps and a person can replay a Zap by hand. Without a
 * stable key per event, one signed proposal becomes three timeline entries and
 * three notifications. Roofr's payloads do not reliably carry an event id, so
 * when none is present we build one from the parts that identify the occurrence
 * itself: type, job, and when it happened. Two genuinely distinct events cannot
 * collide on all three; a redelivery of one event matches on all three.
 *
 * The deliberate consequence: an event with no id and no timestamp cannot be
 * deduplicated, so it is refused rather than accepted as possibly-a-duplicate.
 */
export function idempotencyKey(body: Record<string, unknown>, eventType: RoofrEventType): string | null {
  const explicit = pick(body, ['event_id', 'eventId', 'id', 'zap_event_id'])
  if (explicit !== null) return explicit

  const job = pick(body, ['roofr_job_id', 'job_id', 'jobId', 'external_job_id'])
  const at = parseInstant(body['occurred_at'] ?? body['occurredAt'] ?? body['timestamp'] ?? body['updated_at'])
  if (job === null || at === null) return null
  return `derived:${eventType}:${job}:${at}`
}

export function normalizeEvent(raw: unknown): NormalizeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'body was not a JSON object' }
  }
  const body = raw as Record<string, unknown>

  const eventType = parseEventType(body['event_type'] ?? body['eventType'] ?? body['event'] ?? body['type'])
  if (eventType === null) {
    return { ok: false, reason: 'event_type missing or not one Roofr sends' }
  }

  const providerEventId = idempotencyKey(body, eventType)
  if (providerEventId === null) {
    return {
      ok: false,
      reason: 'no event_id, and not enough of a job id and timestamp to derive one',
    }
  }

  const totalRaw =
    body['proposal_total'] ?? body['proposalTotal'] ?? body['total'] ?? body['amount'] ?? null

  return {
    ok: true,
    event: {
      providerEventId,
      eventType,
      occurredAt: parseInstant(
        body['occurred_at'] ?? body['occurredAt'] ?? body['timestamp'] ?? body['updated_at'],
      ),
      roofrJobId: pick(body, ['roofr_job_id', 'job_id', 'jobId']),
      roofrCustomerId: pick(body, ['roofr_customer_id', 'customer_id', 'customerId']),
      externalJobId: pick(body, ['external_job_id', 'externalJobId', 'external_id']),
      workflowStage: pick(body, ['workflow_stage', 'workflowStage', 'stage', 'new_stage']),
      proposalTotalCents: parseMoneyCents(totalRaw),
      addressLine1: pick(body, ['address_line1', 'address', 'street_address', 'addressLine1']),
      postalCode: pick(body, ['postal_code', 'zip', 'zip_code', 'postalCode']),
    },
  }
}

/**
 * Which columns on roofr_links an event is allowed to touch.
 *
 * Expressed as data rather than a switch so the answer to "can a Roofr event
 * change this field" is readable in one place. Roofr owns its own workflow
 * columns completely; it owns nothing else. In particular nothing here writes
 * to `leads`, because a proposal being viewed is not a reason to move a lead a
 * rep is actively working.
 */
export function linkPatchFor(event: NormalizedEvent): Record<string, string | number> {
  const patch: Record<string, string | number> = {}
  const at = event.occurredAt ?? new Date().toISOString()

  switch (event.eventType) {
    case 'report_ordered':
      patch['report_ordered_at'] = at
      break
    case 'proposal_sent':
      patch['proposal_sent_at'] = at
      break
    case 'proposal_viewed':
      patch['proposal_viewed_at'] = at
      break
    case 'proposal_signed':
      patch['proposal_signed_at'] = at
      break
    case 'proposal_lost':
      patch['proposal_lost_at'] = at
      break
    case 'proposal_total_adjusted':
      // Only when a total actually parsed. An adjustment event whose amount we
      // could not read must not blank a total we already have.
      if (event.proposalTotalCents !== null) patch['proposal_total_cents'] = event.proposalTotalCents
      break
    case 'workflow_stage_changed':
      if (event.workflowStage !== null) patch['workflow_stage'] = event.workflowStage
      break
    case 'lead_created':
    case 'job_created':
      break
  }

  // A total can ride along on any event that carries one; sent and signed
  // proposals usually do.
  if (event.proposalTotalCents !== null && patch['proposal_total_cents'] === undefined) {
    patch['proposal_total_cents'] = event.proposalTotalCents
  }
  if (event.roofrJobId !== null) patch['roofr_job_id'] = event.roofrJobId
  if (event.roofrCustomerId !== null) patch['roofr_customer_id'] = event.roofrCustomerId

  patch['last_event_at'] = at
  return patch
}

/** What a person reads in the lead's timeline. No PII beyond what is already on the lead. */
export function describeEvent(event: NormalizedEvent): string {
  const money =
    event.proposalTotalCents === null
      ? ''
      : ` (${(event.proposalTotalCents / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
        })})`

  switch (event.eventType) {
    case 'lead_created':
      return 'Roofr created a lead from an Instant Estimator submission'
    case 'report_ordered':
      return 'Roofr report ordered'
    case 'proposal_sent':
      return `Proposal sent from Roofr${money}`
    case 'proposal_viewed':
      return 'Homeowner opened the Roofr proposal'
    case 'proposal_signed':
      return `Proposal signed in Roofr${money}`
    case 'proposal_lost':
      return 'Proposal marked lost in Roofr'
    case 'proposal_total_adjusted':
      return `Proposal total adjusted in Roofr${money}`
    case 'workflow_stage_changed':
      return `Roofr job moved to ${event.workflowStage ?? 'a new stage'}`
    case 'job_created':
      return 'Job and customer created in Roofr'
  }
}
