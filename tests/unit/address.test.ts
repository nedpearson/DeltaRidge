import { describe, expect, it } from 'vitest'
import { normalizeAddress, propertyMatchKey } from '@/lib/address'

/**
 * These cases pin the client-side mirror of `app.normalize_address` to the SQL
 * in migration 0001. If that function changes, these fail — which is the point.
 * The consequence of drift is not cosmetic: a mismatch means a duplicate-address
 * insert fails with 23505, the lookup that follows finds nothing, and every
 * photo for that roof wedges in the outbox.
 */
describe('normalizeAddress', () => {
  it('lowercases', () => {
    expect(normalizeAddress('1655 Cottondale Dr')).toBe('1655 cottondale dr')
  })

  it('strips the punctuation the SQL strips, and only that', () => {
    // [.,#] — note the hyphen in "Old Hammond-Jefferson" survives, as it does in SQL.
    expect(normalizeAddress('1655 Cottondale Dr., #4')).toBe('1655 cottondale dr 4')
    expect(normalizeAddress('101 Old Hammond-Jefferson')).toBe('101 old hammond-jefferson')
  })

  it('folds street and str to st on word boundaries', () => {
    expect(normalizeAddress('12 Main Street')).toBe('12 main st')
    expect(normalizeAddress('12 Main Str')).toBe('12 main st')
  })

  it('does not fold street inside a longer word', () => {
    // \y in Postgres is a word boundary, so "Streetsboro" is untouched.
    expect(normalizeAddress('9 Streetsboro Way')).toBe('9 streetsboro way')
  })

  it('collapses whitespace runs without trimming', () => {
    expect(normalizeAddress('12   Main    St')).toBe('12 main st')
  })

  it('returns null for empty input, matching nullif', () => {
    expect(normalizeAddress('')).toBeNull()
    expect(normalizeAddress(null)).toBeNull()
    expect(normalizeAddress(undefined)).toBeNull()
  })

  it('matches the two spellings of the same roof', () => {
    expect(normalizeAddress('1655 Cottondale Drive')).toBe(normalizeAddress('1655 cottondale drive'))
    expect(normalizeAddress('12 Main Street')).toBe(normalizeAddress('12 Main St'))
  })
})

describe('propertyMatchKey', () => {
  it('concatenates address and postal code the way the generated column does', () => {
    expect(propertyMatchKey('1655 Cottondale Dr', '70816')).toBe('1655 cottondale dr 70816')
  })

  it('keeps the trailing space a missing postal code produces', () => {
    // The SQL concatenates unconditionally and the whitespace collapse does not
    // trim, so the stored value ends in a space. Reproducing that exactly is
    // what makes the lookup match.
    expect(propertyMatchKey('1655 Cottondale Dr', null)).toBe('1655 cottondale dr ')
    expect(propertyMatchKey('1655 Cottondale Dr')).toBe('1655 cottondale dr ')
  })
})
