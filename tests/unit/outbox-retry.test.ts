import { describe, expect, it } from 'vitest'
import { backoffDelayMs, isDue } from '@/lib/sync-store'
import { MAX_SYNC_ATTEMPTS } from '@/lib/db'
import { remoteStatusFor } from '@/lib/sync/resolve'

/**
 * The retry schedule is the difference between "the app is quietly burning my
 * battery on a request that will never work" and "the app told me what is
 * stuck". These tests cover the decision logic without a clock or a database.
 */
describe('backoffDelayMs', () => {
  it('starts at five seconds and doubles', () => {
    expect(backoffDelayMs(1)).toBe(5_000)
    expect(backoffDelayMs(2)).toBe(10_000)
    expect(backoffDelayMs(3)).toBe(20_000)
    expect(backoffDelayMs(4)).toBe(40_000)
  })

  it('caps at five minutes rather than growing forever', () => {
    expect(backoffDelayMs(20)).toBe(300_000)
    expect(backoffDelayMs(200)).toBe(300_000)
  })

  it('never returns a negative or zero delay', () => {
    for (const attempts of [0, 1, 5, 50]) expect(backoffDelayMs(attempts)).toBeGreaterThan(0)
  })

  it('spends about five minutes of real retries before giving up', () => {
    // Note being offline is not a failure — the drain skips entirely without
    // touching attempt counts — so these attempts are only ever spent on
    // errors the server actually returned.
    const total = Array.from({ length: MAX_SYNC_ATTEMPTS }, (_, n) => backoffDelayMs(n + 1)).reduce(
      (a, b) => a + b,
      0,
    )
    expect(total).toBe(315_000)
    expect(backoffDelayMs(MAX_SYNC_ATTEMPTS)).toBeLessThan(300_000)
  })
})

describe('isDue', () => {
  const now = Date.parse('2026-09-18T15:00:00.000Z')

  it('treats a never-attempted item as due', () => {
    expect(isDue({}, now)).toBe(true)
  })

  it('holds an item until its backoff expires', () => {
    expect(isDue({ nextAttemptAt: '2026-09-18T15:00:30.000Z' }, now)).toBe(false)
    expect(isDue({ nextAttemptAt: '2026-09-18T14:59:30.000Z' }, now)).toBe(true)
  })

  it('treats the exact boundary as due', () => {
    expect(isDue({ nextAttemptAt: '2026-09-18T15:00:00.000Z' }, now)).toBe(true)
  })

  it('never re-attempts an item that has given up', () => {
    // Stalled items are surfaced to the rep instead; only an explicit retry
    // puts them back in the queue.
    expect(isDue({ givenUp: true }, now)).toBe(false)
    expect(isDue({ givenUp: true, nextAttemptAt: '2020-01-01T00:00:00.000Z' }, now)).toBe(false)
  })
})

/**
 * The one-way door: an inspection that has reached the office must not be
 * walked back to 'complete' by a later push triggered by an unrelated edit.
 */
describe('remoteStatusFor', () => {
  it('maps an open inspection to in_progress', () => {
    expect(remoteStatusFor({ status: 'in_progress' })).toBe('in_progress')
  })

  it('maps a finished but unsent inspection to complete', () => {
    expect(remoteStatusFor({ status: 'complete' })).toBe('complete')
  })

  it('keeps sent_to_office once the package has gone', () => {
    expect(remoteStatusFor({ status: 'complete', sentToOfficeAt: '2026-09-18T15:05:00.000Z' })).toBe(
      'sent_to_office',
    )
  })

  it('does not downgrade a sent inspection that was reopened locally', () => {
    expect(remoteStatusFor({ status: 'in_progress', sentToOfficeAt: '2026-09-18T15:05:00.000Z' })).toBe(
      'sent_to_office',
    )
  })
})
