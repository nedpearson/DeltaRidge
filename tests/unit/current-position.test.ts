import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPosition } from '@/lib/image'

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'geolocation')

function stubGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: impl as Geolocation,
    configurable: true,
  })
}

afterEach(() => {
  vi.useRealTimers()
  if (original) Object.defineProperty(globalThis.navigator, 'geolocation', original)
})

describe('currentPosition', () => {
  /**
   * The regression that matters. The Geolocation spec does not start the
   * `timeout` clock until the permission prompt is answered, so a browser that
   * never answers it fires neither callback. Before this was guarded, the
   * promise stayed pending and "Start inspection" hung on "Getting location…"
   * with no way forward.
   */
  it('resolves null when the browser never answers the permission prompt', async () => {
    vi.useFakeTimers()
    stubGeolocation({ getCurrentPosition: () => undefined })

    const pending = currentPosition(5000)
    let settled = false
    void pending.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(4999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    await expect(pending).resolves.toBeNull()
  })

  it('resolves the position when the browser supplies one', async () => {
    const position = { coords: { latitude: 30.45, longitude: -91.15 } } as GeolocationPosition
    stubGeolocation({
      getCurrentPosition: (success) => success(position),
    })
    await expect(currentPosition(5000)).resolves.toBe(position)
  })

  it('resolves null when the browser reports an error', async () => {
    stubGeolocation({
      getCurrentPosition: (_success, error) => error?.({ code: 1 } as GeolocationPositionError),
    })
    await expect(currentPosition(5000)).resolves.toBeNull()
  })

  it('resolves null rather than throwing when geolocation is absent', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true })
    await expect(currentPosition(5000)).resolves.toBeNull()
  })
})
