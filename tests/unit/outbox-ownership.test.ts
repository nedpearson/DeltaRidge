import { describe, expect, it } from 'vitest'
import { outboxStatus, ownsOutboxItem, type OutboxItem } from '@/lib/db'
import { isAuthError, isDue } from '@/lib/sync-store'

/**
 * Whose work is in the queue, and may this sign-in push it?
 *
 * This is the rule that decides whether a rep's numbers are their own. A field
 * phone gets handed between people, a shift ends with a sign-out, a token
 * expires mid-street. Every one of those used to end with the next person to
 * sign in draining a queue that was not theirs — and there is no way to tell
 * afterwards, because the server sees a normal insert under a valid account.
 */

const ANNA = '11111111-1111-4111-8111-111111111111'
const BEN = '22222222-2222-4222-8222-222222222222'

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'o1',
    entity: 'leadActivity',
    entityId: 'e1',
    queuedAt: '2026-09-23T14:00:00.000Z',
    attempts: 0,
    ...over,
  } as OutboxItem
}

describe('ownsOutboxItem', () => {
  it('lets a rep push their own work', () => {
    expect(ownsOutboxItem(item({ userId: ANNA }), ANNA)).toBe(true)
  })

  it("never lets one rep push another rep's work", () => {
    // The whole point. Anna's knocks must not land under Ben's account just
    // because Ben was the next person to sign in on this phone.
    expect(ownsOutboxItem(item({ userId: ANNA }), BEN)).toBe(false)
  })

  it('does not exempt anyone — there is no admin override', () => {
    expect(ownsOutboxItem(item({ userId: ANNA }), 'any-other-user')).toBe(false)
  })

  it('treats work queued while signed out as claimable', () => {
    // Nobody was signed in when this was captured, so the only person it can
    // belong to is whoever is holding the phone now. Refusing to push it would
    // strand real field work forever.
    expect(ownsOutboxItem(item({ userId: null }), BEN)).toBe(true)
  })

  it('treats items queued before ownership existed as claimable', () => {
    // userId absent, not null: written by a build that could not record one.
    expect(ownsOutboxItem(item(), BEN)).toBe(true)
  })

  it('pushes nothing at all when nobody is signed in', () => {
    expect(ownsOutboxItem(item({ userId: ANNA }), null)).toBe(false)
    expect(ownsOutboxItem(item({ userId: null }), null)).toBe(false)
  })
})

describe('outboxStatus', () => {
  const now = Date.parse('2026-09-23T15:00:00.000Z')

  it('reports work waiting to go', () => {
    expect(outboxStatus(item({ userId: ANNA }), ANNA, now)).toBe('pending')
  })

  it('reports work waiting out a backoff separately from work that is stuck', () => {
    expect(
      outboxStatus(item({ userId: ANNA, nextAttemptAt: '2026-09-23T15:00:30.000Z' }), ANNA, now),
    ).toBe('retry')
  })

  it('names an auth block rather than calling it an error', () => {
    expect(outboxStatus(item({ userId: ANNA, blockedReason: 'auth' }), ANNA, now)).toBe('blocked_auth')
  })

  it("names another rep's work rather than hiding it", () => {
    // Counted and shown, so a phone holding someone else's unsent day says so
    // instead of looking empty.
    expect(outboxStatus(item({ userId: ANNA }), BEN, now)).toBe('not_yours')
  })

  it('reports a given-up item as failed even when it belongs to someone else', () => {
    expect(outboxStatus(item({ userId: ANNA, givenUp: true }), BEN, now)).toBe('failed')
  })
})

describe('isAuthError', () => {
  it('recognises how Supabase words an expired or missing session', () => {
    for (const message of [
      'JWT expired',
      'invalid claim: missing sub claim',
      'Invalid token',
      'User not authenticated',
      'Unauthorized',
      'request failed with status 401',
      'Auth session missing!',
    ]) {
      expect(isAuthError(message), message).toBe(true)
    }
  })

  it('leaves ordinary failures to the normal retry budget', () => {
    // Narrow on purpose: exempting an unknown error from the attempt count is
    // how an item retries forever without anyone being told.
    for (const message of [
      'duplicate key value violates unique constraint "leads_one_open_per_property"',
      'Failed to fetch',
      'new row violates row-level security policy for table "activities"',
      'value too long for type character varying(64)',
    ]) {
      expect(isAuthError(message), message).toBe(false)
    }
  })
})

describe('isDue with an auth block', () => {
  const now = Date.parse('2026-09-23T15:00:00.000Z')

  it('retries immediately once there is a session again', () => {
    // No backoff to wait out: the thing that was wrong was the sign-in, and it
    // has just been fixed. Making a rep wait five minutes after signing back in
    // is how the app looks broken when it is working.
    expect(isDue({ blockedReason: 'auth', nextAttemptAt: '2026-09-23T15:30:00.000Z' }, now)).toBe(true)
  })

  it('still respects a give-up over an auth block', () => {
    expect(isDue({ blockedReason: 'auth', givenUp: true }, now)).toBe(false)
  })
})
