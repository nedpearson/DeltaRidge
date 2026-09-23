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
 */

export type MapStyleKey = 'streets' | 'satellite'

/**
 * Streets by default, not the dark style.
 *
 * The dark style was chosen to match the rest of the app and was the wrong
 * call: a rep is reading this outdoors on a phone in Louisiana sunshine, where
 * a dark map is close to unreadable, and the dark style also drops most road
 * labels. Matching the app's chrome is worth nothing if the map cannot be read
 * in the place it is used.
 *
 * Satellite is the one a roofer actually wants some of the time — you can see
 * the roof, its pitch and its shape before knocking — so it is one tap away
 * rather than absent.
 */
export const MAP_STYLES: Record<MapStyleKey, { id: string; label: string }> = {
  streets: { id: 'mapbox/streets-v12', label: 'Map' },
  satellite: { id: 'mapbox/satellite-streets-v12', label: 'Satellite' },
}

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

/** Mapbox caps a static image at 1280 a side, and @2x doubles what is asked. */
const MAX_REQUEST = 640

/**
 * How much the image has to shrink to fit inside what Mapbox will render.
 *
 * On a phone this is 1 and the image is requested at true retina density. On a
 * wide desktop the map is wider than 640 CSS pixels, so the image is requested
 * smaller and stretched — at @2x that still lands at roughly one device pixel
 * per CSS pixel, which is the difference between crisp street names and the
 * blurred ones that come from rendering 640 pixels across 1,275.
 */
export function requestScale(size: Size): number {
  return Math.min(1, MAX_REQUEST / Math.max(size.width, size.height))
}

export function basemapUrl(view: View, size: Size, style: MapStyleKey = 'streets'): string | null {
  const token = mapboxToken()
  if (!token) return null
  if (size.width <= 0 || size.height <= 0) return null

  const scale = requestScale(size)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))

  /**
   * Fewer pixels covering the same ground means a lower zoom, exactly.
   *
   * Without this the image would cover less ground than the overlay projects
   * across, and every dot would drift outwards from the centre — the bug that
   * looks like "the pins are slightly wrong" and is impossible to eyeball.
   */
  const imageZoom = view.zoom + Math.log2(scale)

  const lon = view.center.longitude.toFixed(5)
  const lat = view.center.latitude.toFixed(5)
  const zoom = imageZoom.toFixed(2)

  return (
    `${ENDPOINT}/${MAP_STYLES[style].id}/static/${lon},${lat},${zoom}/${width}x${height}@2x` +
    `?access_token=${encodeURIComponent(token)}`
  )
}

/**
 * Mapbox's terms require attribution, and the static endpoint draws its own
 * into the image by default — which is why `attribution=false` is not passed
 * above. This string is the text equivalent for anywhere the image is absent.
 */
export const BASEMAP_ATTRIBUTION = '© Mapbox © OpenStreetMap'

/**
 * A satellite tile centred on one house.
 *
 * Deliberately a plain image URL the rep's own browser fetches, and nothing
 * more. Mapbox's product terms (§2.8.1, October 2025) allow caching Licensed
 * Map Content **on the end user's device for up to thirty days, populated
 * directly from the Mapping API** — which is exactly what an `<img>` in a PWA
 * does. The same clause forbids proxying it: fetching these server-side,
 * storing them in Supabase and serving them to reps would breach it, and so
 * would pasting one into a PDF proposal or emailing it to a homeowner
 * ("distribute ... by using a screenshot or other static image"). §2.8.2 also
 * forbids using the imagery to improve other imagery.
 *
 * So: show it in the app, let the device cache it, and never move it anywhere.
 *
 * Zoom 18 frames a suburban lot and its immediate neighbours — close enough to
 * count roof planes and see the driveway, wide enough to recognise the street.
 */
export const PROPERTY_ZOOM = 18

export function propertyImageUrl(
  latitude: number,
  longitude: number,
  size: Size,
  zoom: number = PROPERTY_ZOOM,
): string | null {
  return basemapUrl({ center: { latitude, longitude }, zoom }, size, 'satellite')
}
