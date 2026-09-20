import { beforeEach, describe, expect, it } from 'vitest'
import { basemapUrl, hasBasemap, mapboxToken } from '@/features/leads/basemap'
import { resetEnvCache } from '@/lib/env'
import type { View } from '@/features/leads/map-projection'

const VIEW: View = { center: { latitude: 30.35, longitude: -91.05 }, zoom: 13.42 }
const SIZE = { width: 320, height: 240 }

/**
 * `loadEnv` memoises, so every test that changes the environment has to clear
 * the cache first or it silently reads the previous test's answer.
 */
function withEnv(values: Record<string, string>): void {
  resetEnvCache()
  for (const [key, value] of Object.entries(values)) {
    ;(import.meta.env as Record<string, unknown>)[key] = value
  }
}

const BASE = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaa',
}

beforeEach(() => {
  withEnv({ ...BASE, VITE_MAPBOX_PUBLIC_TOKEN: '' })
})

describe('the token', () => {
  it('is absent until one is set, and the map says so rather than breaking', () => {
    expect(mapboxToken()).toBeNull()
    expect(hasBasemap()).toBe(false)
    expect(basemapUrl(VIEW, SIZE)).toBeNull()
  })

  it('accepts a public token', () => {
    withEnv({ ...BASE, VITE_MAPBOX_PUBLIC_TOKEN: 'pk.eyJ1IjoibmVkIn0.abc123' })
    expect(mapboxToken()).toBe('pk.eyJ1IjoibmVkIn0.abc123')
    expect(hasBasemap()).toBe(true)
  })

  it('refuses anything that is not a public token', () => {
    // A secret token starts sk. and must never reach a browser. Rejecting it
    // here means a paste of the wrong one degrades the map instead of leaking.
    withEnv({ ...BASE, VITE_MAPBOX_PUBLIC_TOKEN: 'sk.eyJ1IjoibmVkIn0.secret' })
    expect(mapboxToken()).toBeNull()
    expect(basemapUrl(VIEW, SIZE)).toBeNull()
  })
})

describe('the image request', () => {
  beforeEach(() => {
    withEnv({ ...BASE, VITE_MAPBOX_PUBLIC_TOKEN: 'pk.test' })
  })

  it('asks for exactly the centre and zoom the overlay is drawn at', () => {
    const url = basemapUrl(VIEW, SIZE)
    expect(url).toContain('/static/-91.05000,30.35000,13.42/')
  })

  it('asks for the size the map is drawn at, at twice the density', () => {
    expect(basemapUrl(VIEW, SIZE)).toContain('/320x240@2x')
  })

  it('stays inside the 640 the endpoint allows before doubling', () => {
    const url = basemapUrl(VIEW, { width: 2000, height: 2000 })
    expect(url).toContain('/640x640@2x')
  })

  it('uses a dark style, because the rest of the app is dark', () => {
    expect(basemapUrl(VIEW, SIZE)).toContain('/styles/v1/mapbox/dark-v11/')
  })

  it('does not turn attribution off', () => {
    // Mapbox draws its own attribution into the image, and their terms require
    // it. Passing attribution=false would be a licence problem, not a style.
    expect(basemapUrl(VIEW, SIZE)).not.toContain('attribution=false')
  })

  it('rounds the centre so a one-pixel drag does not become a new request', () => {
    const a = basemapUrl({ ...VIEW, center: { latitude: 30.350001, longitude: -91.05 } }, SIZE)
    const b = basemapUrl({ ...VIEW, center: { latitude: 30.3500014, longitude: -91.05 } }, SIZE)
    expect(a).toBe(b)
  })
})
