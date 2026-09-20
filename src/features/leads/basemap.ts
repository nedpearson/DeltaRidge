import { loadEnv } from '@/lib/env'
import type { Size, View } from './map-projection'

/**
 * Streets under the dots, as one image rather than a map library.
 *
 * Mapbox GL JS is roughly twice the size of this entire application and needs
 * a live connection to stream vector tiles. The Static Images API returns one
 * raster of exactly the view asked for: a single request, a few hundred
 * kilobytes, cached by the browser, and — crucially — a plain `<img>` that
 * fails to load without taking the rest of the screen down with it. A rep with
 * no signal still gets the dots.
 *
 * The zoom and centre handed to this endpoint are the same ones the overlay
 * projects with, so the alignment is exact rather than approximate.
 */

/** Dark, because the rest of the app is, and a white map at night is blinding. */
const STYLE = 'mapbox/dark-v11'
const ENDPOINT = 'https://api.mapbox.com/styles/v1'

/**
 * A Mapbox PUBLIC token, which is designed to be readable in a browser bundle.
 * It is not a secret and is not treated as one; what protects it is the URL
 * restriction set on it in the Mapbox dashboard. A secret token must never
 * carry a VITE_ prefix — `assertNoServerSecrets` refuses to start if one does.
 */
export function mapboxToken(): string | null {
  try {
    const token = loadEnv().VITE_MAPBOX_PUBLIC_TOKEN
    return token && token.startsWith('pk.') ? token : null
  } catch {
    // A misconfigured environment degrades the map, never the app.
    return null
  }
}

export function hasBasemap(): boolean {
  return mapboxToken() !== null
}

/**
 * Mapbox caps a static image at 1280 on a side, and @2x doubles what is asked
 * for, so the requested size is capped at 640.
 */
const MAX_REQUEST = 640

export function basemapUrl(view: View, size: Size): string | null {
  const token = mapboxToken()
  if (!token) return null

  const width = Math.min(Math.round(size.width), MAX_REQUEST)
  const height = Math.min(Math.round(size.height), MAX_REQUEST)
  // Trimmed to two places so a one-pixel drag does not become a new URL and a
  // new request — the browser cache only helps if the URL repeats.
  const lon = view.center.longitude.toFixed(5)
  const lat = view.center.latitude.toFixed(5)
  const zoom = view.zoom.toFixed(2)

  return (
    `${ENDPOINT}/${STYLE}/static/${lon},${lat},${zoom}/${width}x${height}@2x` +
    `?access_token=${encodeURIComponent(token)}`
  )
}

/**
 * Mapbox's terms require attribution, and the static endpoint draws its own
 * into the image by default — which is why `attribution=false` is not passed
 * above. This string is the text equivalent for anywhere the image is not
 * shown.
 */
export const BASEMAP_ATTRIBUTION = '© Mapbox © OpenStreetMap'
