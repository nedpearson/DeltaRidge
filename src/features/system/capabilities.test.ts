import { describe, expect, it } from 'vitest'
import { buildCapabilities, summarize } from './capabilities'

describe('buildCapabilities', () => {
  it('shows server-dependent items as checking until the probe returns', () => {
    const caps = buildCapabilities(null)
    expect(caps.find((c) => c.id === 'push')?.state).toBe('checking')
    expect(caps.find((c) => c.id === 'routes')?.state).toBe('live')
  })

  it('maps probe results to plain states', () => {
    const caps = buildCapabilities({
      signedIn: true,
      configured: { contacts: false, push: true, roofr: false },
      runs: [{ integration: 'eagleview', status: 'failed', created_at: '2026-10-09T00:00:00Z' }],
      requestsTable: true,
      socialAccounts: 0,
    })
    const by = (id: string) => caps.find((c) => c.id === id)?.state
    expect(by('push')).toBe('live')
    expect(by('roofr')).toBe('not_connected')
    expect(by('imagery')).toBe('error')
    expect(by('storm-check')).toBe('live')
    expect(by('social')).toBe('not_connected')
    const s = summarize(caps)
    expect(s.problems).toBe(1)
    expect(s.live + s.setup + s.problems).toBe(caps.length)
  })

  it('says sign in, not "not set up", when there is no session', () => {
    const caps = buildCapabilities({ signedIn: false, configured: null, runs: [], requestsTable: null, socialAccounts: null })
    expect(caps.find((c) => c.id === 'imagery')?.state).toBe('unknown')
    expect(caps.find((c) => c.id === 'radar')?.state).toBe('live')
  })

  it('never claims property data is complete', () => {
    expect(buildCapabilities(null).find((c) => c.id === 'property')?.state).toBe('partial')
  })
})
