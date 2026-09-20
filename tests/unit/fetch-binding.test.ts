import { describe, expect, it } from 'vitest'
import { boundFetch } from '@/lib/fetch'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import { EbrGeocoder } from '@/integrations/geocode/ebr'
import { createStormProvider } from '@/integrations/storm'

/**
 * Regression test for the bug that made the Leads tab report all three public
 * feeds as unavailable while every feed was actually up.
 *
 * `fetch` is a method of the global object. Stored on an instance and called
 * as `this.fetchImpl(url)`, the receiver becomes the instance and Chrome
 * throws "Illegal invocation" before the request is made - no network entry,
 * no CORS error, no status code, nothing upstream to check.
 *
 * Node's fetch does not care about its receiver, so a fake injected into these
 * providers passed happily while the browser failed every time. These tests
 * therefore assert the RECEIVER, not the response: that is the only thing that
 * differs between the two environments, and asserting anything else would
 * reproduce the original blind spot.
 */

/** Captures `this` at the call site. Must not be an arrow function. */
function receiverCapturingFetch(): {
  readonly impl: typeof fetch
  readonly receivers: unknown[]
} {
  const receivers: unknown[] = []
  const impl = function (this: unknown): Promise<Response> {
    receivers.push(this)
    return Promise.resolve(new Response('{}', { status: 200 }))
  } as unknown as typeof fetch
  return { impl, receivers }
}

describe('boundFetch', () => {
  it('detaches the receiver from whatever object holds it', async () => {
    const { impl, receivers } = receiverCapturingFetch()
    const holder = { f: boundFetch(impl) }
    await holder.f('https://example.test/')
    expect(receivers).toHaveLength(1)
    expect(receivers[0]).not.toBe(holder)
  })

  it('still forwards arguments to the underlying implementation', async () => {
    const calls: unknown[][] = []
    const impl = ((...args: unknown[]) => {
      calls.push(args)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof fetch
    const f = boundFetch(impl)
    await f('https://example.test/x', { method: 'GET' })
    expect(calls[0]?.[0]).toBe('https://example.test/x')
    expect(calls[0]?.[1]).toEqual({ method: 'GET' })
  })
})

describe('no provider calls fetch with itself as the receiver', () => {
  it('EbrPermitProvider', async () => {
    const { impl, receivers } = receiverCapturingFetch()
    const provider = new EbrPermitProvider(impl)
    await provider.search({ kinds: ['reroof'], limit: 1 }).catch(() => undefined)
    expect(receivers.length).toBeGreaterThan(0)
    for (const r of receivers) expect(r).not.toBe(provider)
  })

  it('EbrGeocoder', async () => {
    const { impl, receivers } = receiverCapturingFetch()
    const geocoder = new EbrGeocoder(impl)
    await geocoder.geocodeAll(['1 Main St Baton Rouge LA']).catch(() => undefined)
    expect(receivers.length).toBeGreaterThan(0)
    for (const r of receivers) expect(r).not.toBe(geocoder)
  })

  it('the NOAA storm provider', async () => {
    const { impl, receivers } = receiverCapturingFetch()
    const provider = createStormProvider('noaa', impl)
    await provider
      .searchEvents({
        bbox: [-91.5, 30.1, -90.5, 30.9],
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-09-19T00:00:00.000Z',
        eventTypes: ['hail'],
      })
      .catch(() => undefined)
    expect(receivers.length).toBeGreaterThan(0)
    for (const r of receivers) expect(r).not.toBe(provider)
  })
})
