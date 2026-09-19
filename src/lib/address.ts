/**
 * Client-side mirror of the database's `app.normalize_address`.
 *
 * WHY THIS EXISTS, AND WHY IT IS A LIABILITY WORTH ACCEPTING:
 *
 * `properties` is unique on (organization_id, normalized_address), where
 * normalized_address is a generated column. When two reps inspect the same roof
 * the second insert fails with 23505 and the push layer has to find the row
 * that already exists. Looking it up by `address_line1` is wrong, because the
 * whole point of normalisation is that "1655 Cottondale Dr." and
 * "1655 Cottondale Drive" are the same roof with different spellings — the
 * lookup would miss, and that inspection's photos would wedge in the outbox
 * permanently.
 *
 * So this function reproduces the SQL exactly, and `tests/unit/address.test.ts`
 * pins the cases. If `app.normalize_address` ever changes, this must change in
 * the same commit. The alternative — an RPC round-trip on every property push —
 * costs a request in the one situation where the rep is already on a bad
 * connection.
 */

/**
 * Mirrors:
 *   regexp_replace(
 *     regexp_replace(
 *       regexp_replace(lower(coalesce(raw,'')), '[.,#]', '', 'g'),
 *       '\y(street|str)\y', 'st', 'g'),
 *     '\s+', ' ', 'g')
 * then nullif(..., '')
 *
 * Postgres `\y` is a word boundary, which is JavaScript's `\b`.
 */
export function normalizeAddress(raw: string | null | undefined): string | null {
  const lowered = (raw ?? '').toLowerCase()
  const depunctuated = lowered.replace(/[.,#]/g, '')
  const folded = depunctuated.replace(/\b(street|str)\b/g, 'st')
  const collapsed = folded.replace(/\s+/g, ' ')
  return collapsed === '' ? null : collapsed
}

/**
 * The exact string the generated column is computed from:
 * `address_line1 || ' ' || coalesce(postal_code, '')`.
 *
 * Note the SQL concatenates unconditionally, so a property with no postal code
 * normalises with a trailing space that the whitespace collapse does NOT strip
 * (it collapses runs, it does not trim). Reproduced faithfully rather than
 * tidied, because a "tidier" value here would simply fail to match the row in
 * the database.
 */
export function propertyMatchKey(addressLine1: string, postalCode?: string | null): string | null {
  return normalizeAddress(`${addressLine1} ${postalCode ?? ''}`)
}
