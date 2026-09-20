import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate,
  holdUpdates,
  resetUpdateStateForTests,
  setUpdateAvailable,
  shouldApplyNow,
  subscribeToUpdates,
  type UpdateState,
} from '@/lib/sw-update'

afterEach(() => resetUpdateStateForTests())

describe('update policy', () => {
  it('does not apply when no update is waiting', () => {
    expect(shouldApplyNow({ available: false, holds: [] })).toBe(false)
  })

  it('applies when an update is waiting and nothing is held', () => {
    expect(shouldApplyNow({ available: true, holds: [] })).toBe(true)
  })

  it('does not apply while anything holds it', () => {
    expect(shouldApplyNow({ available: true, holds: ['an inspection is open'] })).toBe(false)
  })
})

describe('holds', () => {
  it('reports the reason so the banner can say why', () => {
    const states: UpdateState[] = []
    subscribeToUpdates((s) => states.push(s))
    setUpdateAvailable(vi.fn())
    holdUpdates('this inspection is open')
    expect(states.at(-1)?.holds).toEqual(['this inspection is open'])
  })

  it('becomes applicable again when the last hold is released', () => {
    const states: UpdateState[] = []
    subscribeToUpdates((s) => states.push(s))
    setUpdateAvailable(vi.fn())
    const release = holdUpdates('this inspection is open')
    expect(shouldApplyNow(states.at(-1)!)).toBe(false)
    release()
    expect(shouldApplyNow(states.at(-1)!)).toBe(true)
  })

  it('needs every hold released, not just one', () => {
    const states: UpdateState[] = []
    subscribeToUpdates((s) => states.push(s))
    setUpdateAvailable(vi.fn())
    const a = holdUpdates('inspection')
    const b = holdUpdates('upload in flight')
    a()
    expect(shouldApplyNow(states.at(-1)!)).toBe(false)
    b()
    expect(shouldApplyNow(states.at(-1)!)).toBe(true)
  })

  it('keeps two holds with the same reason distinct', () => {
    const states: UpdateState[] = []
    subscribeToUpdates((s) => states.push(s))
    setUpdateAvailable(vi.fn())
    const first = holdUpdates('upload in flight')
    holdUpdates('upload in flight')
    first()
    expect(states.at(-1)?.holds).toEqual(['upload in flight'])
    expect(shouldApplyNow(states.at(-1)!)).toBe(false)
  })
})

describe('applying', () => {
  it('reloads through the registered function', () => {
    const fn = vi.fn()
    setUpdateAvailable(fn)
    applyUpdate()
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('cannot fire twice, so the reload is never raced', () => {
    const fn = vi.fn()
    setUpdateAvailable(fn)
    applyUpdate()
    applyUpdate()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when nothing is waiting', () => {
    expect(() => applyUpdate()).not.toThrow()
  })

  it('applies even while held, because that path is the explicit button', () => {
    const fn = vi.fn()
    setUpdateAvailable(fn)
    holdUpdates('this inspection is open')
    applyUpdate()
    expect(fn).toHaveBeenCalledWith(true)
  })
})

describe('subscription', () => {
  it('delivers the current state immediately', () => {
    const seen: UpdateState[] = []
    subscribeToUpdates((s) => seen.push(s))
    expect(seen[0]).toEqual({ available: false, holds: [] })
  })

  it('stops delivering once unsubscribed', () => {
    const seen: UpdateState[] = []
    const off = subscribeToUpdates((s) => seen.push(s))
    const before = seen.length
    off()
    setUpdateAvailable(vi.fn())
    expect(seen).toHaveLength(before)
  })
})
