/**
 * One id that follows a piece of field work all the way through.
 *
 * The question this exists to answer is "what happened to this lead?", asked by
 * a manager on the phone while a rep stands in a driveway insisting they
 * recorded something. Today that question takes an afternoon and a database
 * client. With a trace id it takes a text box.
 *
 * The id is generated on the DEVICE, at the moment the rep acts, not on the
 * server when the row arrives. That is the whole point: the interesting
 * failures happen before the server ever hears about the work, and an id minted
 * server-side cannot describe them.
 */

/**
 * Crockford base32: no I, L, O or U.
 *
 * Chosen because these ids get read aloud. A rep on a bad line saying "tr_0IL1"
 * to somebody typing it into a search box is a support call that goes nowhere,
 * and the excluded letters are exactly the ones that collide with 1 and 0 when
 * spoken or when read off a cracked screen. The alphabet also decodes
 * case-insensitively, so it survives a phone keyboard's autocapitalisation.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encode(value: number, length: number): string {
  let out = ''
  let n = value
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[n % 32] + out
    n = Math.floor(n / 32)
  }
  return out
}

function randomChars(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % 32]
  return out
}

/**
 * How many base32 characters the timestamp gets.
 *
 * NINE, and the number is load-bearing. Eight was the first attempt and it is
 * wrong: 32^8 milliseconds is about 34.8 years, so an eight-character prefix
 * overflowed in 2004 and every id since would have carried a silently truncated
 * timestamp — sorting correctly by luck, decoding to a date in 1991. Nine gives
 * 32^9 ms, a little over 1,100 years from the epoch, which is genuinely enough.
 *
 * Caught by the test that decodes an id back to the time it was minted. Worth
 * noting that the two tests either side of it — uniqueness and string sort —
 * both passed on the broken version, because truncation preserves ordering
 * within any 34-year window. A property can look thoroughly tested and still be
 * wrong if nothing ever checks the actual value.
 */
const TIME_CHARS = 9
/** 32^7 ≈ 34 billion, so a burst of thousands in one millisecond will not collide. */
const RANDOM_CHARS = 7

/**
 * A new trace id.
 *
 * Time-prefixed so ids sort chronologically and a support person can tell at a
 * glance whether they are looking at something from this morning or from March.
 */
export function newTraceId(now: number = Date.now()): string {
  return `tr_${encode(now, TIME_CHARS)}${randomChars(RANDOM_CHARS)}`
}

const TRACE_PATTERN = new RegExp(`^tr_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{${TIME_CHARS + RANDOM_CHARS}}$`)

/** Case-insensitive, because these get typed by hand from a phone screen. */
export function isTraceId(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('tr_')) return false
  return TRACE_PATTERN.test(`tr_${trimmed.slice(3).toUpperCase()}`)
}

/** Recovers when a trace started, for sorting a list of them. */
export function traceStartedAt(traceId: string): Date | null {
  if (!isTraceId(traceId)) return null
  const chars = traceId.slice(3, 3 + TIME_CHARS).toUpperCase()
  let value = 0
  for (const char of chars) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) return null
    value = value * 32 + index
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Where a step happened.
 *
 * Named after the machine that ran it, not the feature, because the first thing
 * anybody wants to know about a missing record is which side of the network it
 * got lost on.
 */
export type TraceLayer =
  /** The rep's phone, before anything left it. */
  | 'device'
  /** The durable queue on the phone. */
  | 'outbox'
  /** Our own server: Edge Functions and PostgREST writes. */
  | 'server'
  /** A request we made to somebody else. */
  | 'outbound'
  /** Something somebody else sent us. */
  | 'inbound'

export type TraceOutcome =
  | 'started'
  | 'ok'
  /** A rule said no. Not a fault: the system worked. */
  | 'refused'
  | 'failed'
  /**
   * We genuinely do not know.
   *
   * A timeout on a write is the canonical case. Recording it as `failed` is a
   * lie that invites a retry, and a retry of a write that may have landed is
   * how one lead becomes two jobs.
   */
  | 'unknown'

export interface TraceStep {
  readonly traceId: string
  readonly layer: TraceLayer
  /** Short, stable, greppable: 'knock.recorded', 'outbox.queued', 'roofr.push.sent'. */
  readonly step: string
  readonly outcome: TraceOutcome
  readonly leadId?: string
  readonly entity?: string
  readonly entityId?: string
  /**
   * One short human sentence.
   *
   * NEVER a payload, a token, a homeowner's name or a phone number. A trace is
   * read by whoever is debugging, which is a wider audience than whoever may
   * see the lead, and nothing here is worth widening PII exposure for.
   */
  readonly detail?: string
  /** When the DEVICE believed this happened. Kept separate from server time. */
  readonly deviceAt: string
}

/** Steps this app emits. Listed so they can be grepped and so two spellings cannot drift apart. */
export const STEPS = {
  knockRecorded: 'knock.recorded',
  contactLogged: 'contact.logged',
  consentRecorded: 'consent.recorded',
  outboxQueued: 'outbox.queued',
  outboxAttempt: 'outbox.attempt',
  outboxBlocked: 'outbox.blocked',
  outboxGaveUp: 'outbox.gave_up',
  serverAccepted: 'server.accepted',
  roofrPushQueued: 'roofr.push.queued',
  roofrPushSent: 'roofr.push.sent',
  roofrEventReceived: 'roofr.event.received',
  roofrEventMatched: 'roofr.event.matched',
  roofrEventUnmatched: 'roofr.event.unmatched',
  roofrJobAcknowledged: 'roofr.job.acknowledged',
} as const

/**
 * Whether a detail line is safe to store.
 *
 * Belt and braces over the convention above: a trace detail travels further
 * than the lead it describes, so anything that looks like a phone number, an
 * email or a long secret is refused rather than trusted to have been written
 * carefully. Returns the reason so a test can say what it caught.
 */
export function detailIsSafe(detail: string): { safe: true } | { safe: false; reason: string } {
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(detail)) {
    return { safe: false, reason: 'looks like a phone number' }
  }
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(detail)) {
    return { safe: false, reason: 'looks like an email address' }
  }
  // Long unbroken alphanumerics are how a token gets into a log by accident.
  if (/[A-Za-z0-9_-]{32,}/.test(detail)) {
    return { safe: false, reason: 'looks like a token or key' }
  }
  if (detail.length > 200) return { safe: false, reason: 'too long to be a summary' }
  return { safe: true }
}
