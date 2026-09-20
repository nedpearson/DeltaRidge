import { beforeEach, describe, expect, it } from 'vitest'
import { basemapUrl, hasBasemap, mapboxToken, requestScale } from '@/features/leads/basemap'
import { resetEnvCache } from '@/lib/env'
import type { View } from '@/features/leads/map-projection'

const VIEW: View = { center: { latitude: 30.35, longitude: -91.05 }, zoom: 13.42 }
const PHONE = { width: 360, height: 280 }
const DESKTOP = { width: 1280, height: 288 }

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
    expect(basemapUrl(VIEW, PHONE)).toBeNull()
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
    expect(basemapUrl(VIEW, PHONE)).toBeNull()
  })
})

describe('asking for the right number of pixels', () => {
  it('asks at full size when the map fits inside what Mapbox will render', () => {
    expect(requestScale(PHONE)).toBe(1)
  })

  it('shrinks the request for a map wider than Mapbox will render', () => {
    expect(requestScale(DESKTOP)).toBeCloseTo(0.5, 6)
  })

  it('never asks for more than Mapbox allows before the @2x doubling', () => {
    const scale = requestScale({ width: 4000, height: 3000 })
    expect(4000 * scale).toBeLessThanOrEqual(640)
    expect(3000 * scale).toBeLessThanOrEqual(640)
  })
})

describe('the image request', () => {
  beforeEach(() => {
    withEnv({ ...BASE, VITE_MAPBOX_PUBLIC_TOKEN: 'pk.test' })
  })

  it('asks for exactly the pixels the map is drawn at, on a phone', () => {
    const url = basemapUrl(VIEW, PHONE)
    expect(url).toContain('/360x280@2x')
    // Nothing was shrunk, so the zoom is the one the overlay projects at.
    expect(url).toContain(',13.42/')
  })

  it('drops the zoom by exactly what it shrank, so the ground still matches', () => {
    // Half the pixels covering the same ground is one zoom level lower. Get
    // this wrong and every dot drifts outwards from the centre — the bug that
    // reads as "the pins are slightly off" and cannot be eyeballed.
    const url = basemapUrl(VIEW, DESKTOP)
    expect(url).toContain('/640x144@2x')
    expect(url).toContain(',12.42/')
  })

  it('keeps the requested shape the same as the map, so nothing is cropped', () => {
    const url = basemapUrl(VIEW, DESKTOP) as string
    const [, w, h] = /\/(\d+)x(\d+)@2x/.exec(url) as RegExpExecArray
    expect(Number(w) / Number(h)).toBeCloseTo(DESKTOP.width / DESKTOP.height, 1)
  })

  it('uses a light street style by default, not the dark one', () => {
    // A rep reads this outdoors in Louisiana sunshine. Matching the app's dark
    // chrome is worth nothing if the map cannot be read where it is used.
    expect(basemapUrl(VIEW, PHONE)).toContain('/styles/v1/mapbox/streets-v12/')
  })

  it('offers satellite, which is the view a roofer actually wants sometimes', () => {
    expect(basemapUrl(VIEW, PHONE, 'satellite')).toContain(
      '/styles/v1/mapbox/satellite-streets-v12/',
    )
  })

  it('does not turn attribution off', () => {
    // Mapbox draws its own attribution into the image, and their terms require
    // it. Passing attribution=false would be a licence problem, not a style.
    expect(basemapUrl(VIEW, PHONE)).not.toContain('attribution=false')
  })

  it('rounds the centre so a one-pixel drag does not become a new request', () => {
    const a = basemapUrl({ ...VIEW, center: { latitude: 30.350001, longitude: -91.05 } }, PHONE)
    const b = basemapUrl({ ...VIEW, center: { latitude: 30.3500014, longitude: -91.05 } }, PHONE)
    expect(a).toBe(b)
  })

  it('asks for nothing before the map has been measured', () => {
    expect(basemapUrl(VIEW, { width: 0, height: 0 })).toBeNull()
  })
})
