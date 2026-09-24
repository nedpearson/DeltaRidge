/**
 * More than one number, and which of them to believe.
 *
 * A people-search provider will happily return five numbers for a household:
 * one current mobile, a landline disconnected in 2019, an ex-husband's cell, a
 * number that now belongs to a stranger, and the homeowner's work line. All
 * five arrive with the same shrug of a confidence score. The rep finds out
 * which is which by dialling, and that knowledge is worth more than anything
 * the provider said — so this module is built around one rule:
 *
 *   What a person established by calling outranks what a provider asserted,
 *   always, and a later provider refresh never quietly undoes it.
 *
 * The second rule follows from the first: nothing here invents a fact the
 * provider did not supply. No phone type, no confidence, no "verified" date. If
 * the provider did not say whether a number is a mobile, the app says it does
 * not know, because a rep who sees "Mobile" will text it.
 */

export type PhoneLabel = 'primary' | 'secondary' | 'other'

/**
 * What a person found out by using the number.
 *
 * `unconfirmed` is the honest starting state for anything a provider supplied.
 * It is not a criticism of the provider; it is a statement that nobody has
 * dialled it yet.
 */
export type PhoneStatus =
  | 'unconfirmed'
  /** Somebody reached the homeowner on it. */
  | 'confirmed'
  /** Somebody reached a person who is not the homeowner. */
  | 'wrong_number'
  /** Dead line, or a carrier message. */
  | 'disconnected'
  /** The homeowner asked not to be called. Terminal, and it travels. */
  | 'do_not_call'

/** Only ever what the provider said. Never inferred from the number itself. */
export type PhoneKind = 'mobile' | 'landline' | 'voip' | 'unknown'

export interface PhoneRecord {
  readonly id: string
  /** As dialled. Formatting is display; comparison uses digits only. */
  readonly number: string
  readonly label: PhoneLabel
  readonly status: PhoneStatus
  /**
   * What the provider called it, or 'unknown'.
   *
   * There is no code path that guesses this from an area code or a prefix. A
   * wrong guess here is a text message to a landline at best and a TCPA
   * question at worst.
   */
  readonly kind: PhoneKind
  /** Which of Delta Ridge's contact sources this came from. */
  readonly source: string
  /** The provider's own confidence, if it gave one. Never manufactured. */
  readonly providerConfidence: 'high' | 'medium' | 'low' | null
  readonly enteredBy: string | null
  readonly enteredAt: string
  readonly statusSetBy: string | null
  readonly statusSetAt: string | null
}

/**
 * The digits that identify the line, with any extension removed.
 *
 * The extension has to go before the digits are taken, or "555-0142 x12"
 * becomes the eleven-digit 5550142_12 and stops matching the same line written
 * without it. That miss is not cosmetic: it let a provider refresh mint a
 * brand-new `unconfirmed` record for a line somebody had already marked
 * do-not-call, and the new record — having no suppression on it — went
 * straight back to the top of the dial list.
 */
export function digitsOf(number: string): string {
  /*
   * `x` cannot carry a trailing \b: in "0142 x12" the x is followed by a digit,
   * so x-to-1 is not a word boundary and the whole alternative failed to match.
   * The leading (?:\s|^) does the anchoring instead, which is what was actually
   * wanted — an extension marker starts a token, it does not end one.
   */
  const withoutExtension = number.replace(
    /(?:\s|^)(?:ext(?:ension)?|x|#)\.?\s*\d+\s*$/i,
    '',
  )
  return withoutExtension.replace(/\D/g, '')
}

/** Two numbers are the same number if their digits are. */
export function sameNumber(a: string, b: string): boolean {
  const left = digitsOf(a)
  const right = digitsOf(b)
  if (left === '' || right === '') return false
  // A leading US country code is not a different number.
  const norm = (d: string) => (d.length === 11 && d.startsWith('1') ? d.slice(1) : d)
  return norm(left) === norm(right)
}

/**
 * Whether this number may be dialled at all, on the evidence about the number
 * itself. Consent and calling hours are decided elsewhere and both still apply.
 */
const DIALABLE: ReadonlySet<PhoneStatus> = new Set<PhoneStatus>(['unconfirmed', 'confirmed'])

export function isDialable(phone: PhoneRecord): boolean {
  /*
   * An allow-list, not a deny-list, and the difference is not stylistic.
   *
   * This was written as `!== 'do_not_call' && !== 'disconnected'`, which let
   * `wrong_number` through — a number where a rep already reached a stranger.
   * `bestPhone` would hand it back as the number to dial, and the stranger
   * would get called again, which is the precise failure the merge path a
   * hundred lines below is built to prevent. A deny-list is wrong by default
   * for any status added later; an allow-list is safe by default.
   */
  return DIALABLE.has(phone.status)
}

/**
 * Sort order: what a person established, then what a provider offered.
 *
 * Confirmed numbers first regardless of label, because a rep who has actually
 * spoken to the homeowner on the "secondary" number should not have to scroll
 * past a provider's guess to find it. Dead ends sink to the bottom rather than
 * disappearing — a rep needs to see that a number was tried, or they will try
 * it again next week.
 */
const STATUS_RANK: Record<PhoneStatus, number> = {
  confirmed: 0,
  unconfirmed: 1,
  wrong_number: 2,
  disconnected: 3,
  do_not_call: 4,
}

const LABEL_RANK: Record<PhoneLabel, number> = { primary: 0, secondary: 1, other: 2 }

export function rankPhones(phones: readonly PhoneRecord[]): PhoneRecord[] {
  return [...phones].sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) {
      return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    }
    if (LABEL_RANK[a.label] !== LABEL_RANK[b.label]) {
      return LABEL_RANK[a.label] - LABEL_RANK[b.label]
    }
    return a.enteredAt.localeCompare(b.enteredAt)
  })
}

/** The number to offer first, or null when there is nothing worth dialling. */
export function bestPhone(phones: readonly PhoneRecord[]): PhoneRecord | null {
  return rankPhones(phones).find(isDialable) ?? null
}

export function setPrimary(
  phones: readonly PhoneRecord[],
  id: string,
): PhoneRecord[] {
  /*
   * If the target is gone, change nothing.
   *
   * The demote branch used to run whether or not the promote branch matched, so
   * tapping "make primary" on a number another device had since removed left
   * the lead with no primary at all — the function breaking the one invariant
   * it exists to maintain.
   */
  if (!phones.some((phone) => phone.id === id)) return [...phones]
  return phones.map((phone) => {
    if (phone.id === id) return { ...phone, label: 'primary' }
    // Exactly one primary. The one being demoted becomes secondary rather than
    // 'other', so a deliberate ordering a rep built is not flattened.
    return phone.label === 'primary' ? { ...phone, label: 'secondary' } : phone
  })
}

/**
 * Whether a number is suppressed, asked of the NUMBER rather than of a record.
 *
 * Suppression has to be a property of the line, not of a row, because a
 * provider refresh can hand back the same line in a different format and mint a
 * second row for it. If do-not-call lived only on the first row, the second one
 * would arrive clean and dialable.
 */
export function isSuppressed(phones: readonly PhoneRecord[], number: string): boolean {
  return phones.some(
    (phone) => sameNumber(phone.number, number) && phone.status === 'do_not_call',
  )
}

/** Statuses a person is not allowed to reverse with an ordinary status change. */
const TERMINAL: ReadonlySet<PhoneStatus> = new Set<PhoneStatus>(['do_not_call'])

export type StatusChange =
  | { readonly ok: true; readonly phones: PhoneRecord[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Record what somebody found out by using the number.
 *
 * Refuses to move a number off do-not-call. The type said "terminal, and it
 * travels" while the function was an unconditional overwrite, so a second rep
 * tapping the wrong row in a dropdown could un-suppress a homeowner who had
 * asked not to be called — and overwrite the record of who suppressed it, so
 * nothing would show it had ever happened. Lifting it is a deliberate,
 * separately named act; see `liftDoNotCall`.
 */
export function setStatus(
  phones: readonly PhoneRecord[],
  id: string,
  status: PhoneStatus,
  by: string,
  at: string,
): StatusChange {
  const target = phones.find((phone) => phone.id === id)
  if (target === undefined) return { ok: false, reason: 'That number is no longer on this lead.' }
  if (TERMINAL.has(target.status) && target.status !== status) {
    return {
      ok: false,
      reason: 'This homeowner asked not to be called. That cannot be undone from here.',
    }
  }
  return {
    ok: true,
    phones: phones.map((phone) =>
      phone.id === id ? { ...phone, status, statusSetBy: by, statusSetAt: at } : phone,
    ),
  }
}

/**
 * Lift a do-not-call, deliberately and with a reason.
 *
 * Exists so that reversing a suppression cannot happen by tapping the wrong
 * item in a list. It applies to every record holding that number, because
 * suppression is a property of the line.
 */
export function liftDoNotCall(
  phones: readonly PhoneRecord[],
  number: string,
  by: string,
  at: string,
  reason: string,
): StatusChange {
  if (reason.trim() === '') {
    return { ok: false, reason: 'Say why the homeowner is contactable again.' }
  }
  return {
    ok: true,
    phones: phones.map((phone) =>
      sameNumber(phone.number, number) && phone.status === 'do_not_call'
        ? { ...phone, status: 'unconfirmed', statusSetBy: by, statusSetAt: at }
        : phone,
    ),
  }
}

export interface ProviderPhone {
  readonly number: string
  readonly kind: PhoneKind
  readonly providerConfidence: 'high' | 'medium' | 'low' | null
}

export interface MergeOutcome {
  readonly phones: PhoneRecord[]
  /** Numbers the provider returned that we did not already hold. */
  readonly added: number
  /**
   * Held numbers whose human-set status this refresh returned unchanged.
   *
   * Counted against the OUTPUT, not the input. Computing it from `existing`
   * made it an assertion that could never fail: the function could have reset
   * every status and the number would have been identical.
   */
  readonly preserved: number
  /**
   * Numbers we hold that the provider no longer returns.
   *
   * Reported, never deleted. A provider dropping a number is not evidence the
   * number is wrong — it is evidence about the provider's data that week — and
   * a rep who confirmed it by speaking to the homeowner would be baffled to
   * find it gone.
   */
  readonly noLongerReturned: number
  /** Incoming numbers refused because that line is suppressed. */
  readonly suppressed: number
  /** Duplicate spellings within the provider's own response. */
  readonly duplicatesInBatch: number
}

export type MergeResult =
  | { readonly ok: true; readonly outcome: MergeOutcome }
  | { readonly ok: false; readonly reason: string }

export interface MergeContext {
  readonly source: string
  readonly at: string
  readonly by: string | null
  /**
   * A fresh id each call, taking no arguments.
   *
   * It used to take the index within the incoming batch, which made it a
   * per-call counter rather than a global one — so the obvious implementation,
   * `(n) => \`new-\${n}\``, minted "new-0" on every refresh. `setStatus` and
   * `setPrimary` both match on id inside a map, so marking one number
   * do-not-call silently suppressed an unrelated one carrying the same id.
   * Removing the parameter removes the invitation.
   */
  readonly newId: () => string
}

/**
 * Fold a provider refresh into what we already hold.
 *
 * The whole function is about what it refuses to do. It adds numbers it has not
 * seen. It does not change the status of anything, it does not re-order, it
 * does not delete, and it does not upgrade an existing record's provider
 * confidence — because the alternative is a refresh quietly resetting a number
 * a rep marked `wrong_number` back to `unconfirmed`, and the rep dialling it
 * again, and the stranger on the other end getting another call.
 *
 * It also refuses to run at all unless the provider gate says the lookup was
 * permitted. That coupling is in the signature rather than left to the caller,
 * because an ingestion function that a caller can simply forget to guard is not
 * a gate — it is a suggestion.
 */
export function mergeProviderPhones(
  existing: readonly PhoneRecord[],
  incoming: readonly ProviderPhone[],
  context: MergeContext,
  permission: { readonly allowed: boolean; readonly reason?: string },
): MergeResult {
  if (!permission.allowed) {
    return {
      ok: false,
      reason: permission.reason ?? 'This provider is not permitted for this organisation.',
    }
  }

  const added: PhoneRecord[] = []
  let suppressed = 0
  let duplicatesInBatch = 0

  for (const candidate of incoming) {
    /*
     * Suppression is checked FIRST, ahead of the ordinary duplicate check.
     *
     * Both branches decline to add the number, so the outcome is the same
     * either way — but the counts are what a person reads in the sync log, and
     * "we declined this because the homeowner asked not to be called" is a
     * materially different sentence from "we already had it". Ordering the
     * cheap dedupe first would have reported every suppressed line as a
     * routine duplicate and hidden the interesting case entirely.
     */
    if (isSuppressed(existing, candidate.number)) {
      suppressed += 1
      continue
    }

    if (existing.some((phone) => sameNumber(phone.number, candidate.number))) continue

    // Within the batch too. A provider returning the same line in E.164 and
    // national format is ordinary, and both spellings used to survive — landing
    // two records with contradictory `kind` values on a fresh lead.
    if (added.some((phone) => sameNumber(phone.number, candidate.number))) {
      duplicatesInBatch += 1
      continue
    }

    added.push({
      id: context.newId(),
      number: candidate.number,
      // Never primary on arrival, including on an empty lead. A number nobody
      // has dialled has not earned a ranking the provider did not give it.
      label: 'other',
      status: 'unconfirmed',
      kind: candidate.kind,
      source: context.source,
      providerConfidence: candidate.providerConfidence,
      // The provider supplied this, not a person, so no human is stamped on it.
      enteredBy: null,
      enteredAt: context.at,
      statusSetBy: null,
      statusSetAt: null,
    })
  }

  const phones = [...existing, ...added]

  const preserved = phones.filter((phone) => {
    const before = existing.find((prior) => prior.id === phone.id)
    return (
      before !== undefined &&
      before.statusSetBy !== null &&
      before.status === phone.status &&
      before.statusSetBy === phone.statusSetBy
    )
  }).length

  const noLongerReturned = existing.filter(
    (phone) => !incoming.some((candidate) => sameNumber(phone.number, candidate.number)),
  ).length

  return {
    ok: true,
    outcome: { phones, added: added.length, preserved, noLongerReturned, suppressed, duplicatesInBatch },
  }
}
