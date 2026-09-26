import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { mapboxToken, MAP_STYLES, type MapStyleKey } from '@/features/leads/basemap'
import { boundsOf, padBounds, workingBounds } from '@/features/leads/map-projection'
import {
  colourExpression,
  LEGEND,
  LEGEND_COLOUR,
  markersFor,
  markersToGeoJson,
  stormsToGeoJson,
  type Marker,
} from '@/features/leads/markers'
import { STATUS_LABEL, type LeadStatus, type ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'
import { searchCircleGeoJson } from '@/features/leads/search-area'

/**
 * A real map: pans under a finger, pinches to zoom, labels every street.
 *
 * This replaced a static image, and the reason is worth keeping. The image was
 * chosen for size and for working offline, and it did both — but a canvassing
 * map that cannot be dragged is not a map, it is a picture of one, and a rep
 * comparing it to the maps already on their phone was right to reject it.
 *
 * The cost is honest: Mapbox GL is a large library. It is loaded LAZILY, in
 * its own chunk, so the inspection flow and the estimator never pay for it,
 * and `LeadMapStatic` still covers the case this cannot — no signal, no WebGL,
 * no token.
 */

const DOORS_SOURCE = 'doors'
const DOORS_LAYER = 'doors-circles'
const STORMS_SOURCE = 'storms'
const STORMS_LAYER = 'storms-circles'
const SEARCH_SOURCE = 'search-area'
const SEARCH_FILL_LAYER = 'search-area-fill'
const SEARCH_LINE_LAYER = 'search-area-line'
const SEARCH_CENTER_LAYER = 'search-area-center'

export default function LeadMapLive({
  doors,
  leads,
  storms,
  searchCenter = null,
  searchRadiusMiles = 3,
  onOpenLead,
  onFailed,
}: {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  searchCenter?: { latitude: number; longitude: number; accuracyMeters?: number } | null
  searchRadiusMiles?: number
  onOpenLead: (leadId: string) => void
  /** Called when the map cannot run at all, so the caller can fall back. */
  onFailed: () => void
}) {
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [style, setStyle] = useState<MapStyleKey>('streets')
  const [selected, setSelected] = useState<Marker | null>(null)

  const markers = markersFor(doors, leads)
  // Kept in a ref so the map's own event handlers always see the current list
  // without the map having to be torn down and rebuilt when a door is knocked.
  const markersRef = useRef(markers)
  markersRef.current = markers

  /**
   * Adds our two layers to whatever style is loaded.
   *
   * Called again after every style switch, because `setStyle` discards every
   * source and layer that was not part of the style itself — a Mapbox
   * behaviour that silently empties the map if you forget it.
   */
  const paintLayers = useCallback((map: mapboxgl.Map) => {
    if (searchCenter) {
      const area = {
        type: 'FeatureCollection',
        features: [
          searchCircleGeoJson(searchCenter, searchRadiusMiles),
          {
            type: 'Feature',
            properties: { kind: 'center' },
            geometry: {
              type: 'Point',
              coordinates: [searchCenter.longitude, searchCenter.latitude],
            },
          },
        ],
      } as const

      if (!map.getSource(SEARCH_SOURCE)) {
        map.addSource(SEARCH_SOURCE, { type: 'geojson', data: area as never })
      } else {
        const source = map.getSource(SEARCH_SOURCE)
        if (source && 'setData' in source) {
          ;(source as mapboxgl.GeoJSONSource).setData(area as never)
        }
      }

      if (!map.getLayer(SEARCH_FILL_LAYER)) {
        map.addLayer({
          id: SEARCH_FILL_LAYER,
          type: 'fill',
          source: SEARCH_SOURCE,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': '#27C6E8',
            'fill-opacity': 0.055,
          },
        })
      }
      if (!map.getLayer(SEARCH_LINE_LAYER)) {
        map.addLayer({
          id: SEARCH_LINE_LAYER,
          type: 'line',
          source: SEARCH_SOURCE,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'line-color': '#27C6E8',
            'line-opacity': 0.7,
            'line-width': 2,
          },
        })
      }
      if (!map.getLayer(SEARCH_CENTER_LAYER)) {
        map.addLayer({
          id: SEARCH_CENTER_LAYER,
          type: 'circle',
          source: SEARCH_SOURCE,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 6,
            'circle-color': '#27C6E8',
            'circle-stroke-color': '#F7FAFC',
            'circle-stroke-width': 2,
          },
        })
      }
    }
    if (!map.getSource(STORMS_SOURCE)) {
      map.addSource(STORMS_SOURCE, { type: 'geojson', data: stormsToGeoJson(storms) as never })
    }
    if (!map.getLayer(STORMS_LAYER)) {
      map.addLayer({
        id: STORMS_LAYER,
        type: 'circle',
        source: STORMS_SOURCE,
        paint: {
          // Grows with zoom so the ring keeps roughly the same footprint on
          // the ground rather than shrinking into a dot as you zoom in.
          'circle-radius': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            8,
            ['*', ['get', 'hail'], 4],
            16,
            ['*', ['get', 'hail'], 120],
          ],
          'circle-color': '#b45309',
          'circle-opacity': 0.1,
          'circle-stroke-color': '#b45309',
          'circle-stroke-opacity': 0.35,
          'circle-stroke-width': 1,
        },
      })
    }

    if (!map.getSource(DOORS_SOURCE)) {
      map.addSource(DOORS_SOURCE, {
        type: 'geojson',
        data: markersToGeoJson(markersRef.current) as never,
      })
    }
    if (!map.getLayer(DOORS_LAYER)) {
      map.addLayer({
        id: DOORS_LAYER,
        type: 'circle',
        source: DOORS_SOURCE,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['case', ['==', ['get', 'status'], 'door'], 3.5, 5],
            16,
            ['case', ['==', ['get', 'status'], 'door'], 7, 9],
          ],
          'circle-color': colourExpression() as never,
          // The halo. Without it a slate dot disappears into a grey road and a
          // white-stroked one disappears into a driveway.
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      })
    }
  }, [searchCenter, searchRadiusMiles, storms])

  const attachMap = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || mapRef.current) return

      const token = mapboxToken()
      if (!token) {
        onFailed()
        return
      }
      // No explicit WebGL check: `supported()` was removed in Mapbox GL v3,
      // and the constructor below throws on a device that cannot run it
      // anyway. Catching that is version-proof where a feature test is not.
      const bounds = workingBounds(markersRef.current) ?? boundsOf(markersRef.current)

      let map: mapboxgl.Map
      try {
        map = new mapboxgl.Map({
          container: node,
          accessToken: token,
          style: `mapbox://styles/${MAP_STYLES.streets.id}`,
          center: [-91.05, 30.4],
          zoom: 9,
          attributionControl: true,
        })
      } catch {
        onFailed()
        return
      }

      mapRef.current = map

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right')
      // Where the rep is standing. On a canvassing map this is the control
      // that gets used most, which is why it is not buried in a menu.
      map.addControl(
        new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserHeading: true,
        }),
        'bottom-right',
      )

      if (bounds) {
        const padded = padBounds(bounds, 0.05)
        map.fitBounds(
          [
            [padded.west, padded.south],
            [padded.east, padded.north],
          ],
          { padding: 28, duration: 0 },
        )
      }

      map.on('load', () => {
        paintLayers(map)
        // Belt and braces: if anything sized the container after the map was
        // constructed, GL is still holding the old dimensions until told.
        map.resize()
        setReady(true)
      })

      // A style switch throws away every source and layer we added.
      map.on('style.load', () => paintLayers(map))

      map.on('click', DOORS_LAYER, (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        // Mapbox's feature type does not expose `properties` across versions,
        // and the values come back as plain JSON either way.
        const props = (feature as unknown as { properties?: Record<string, unknown> }).properties
        const id = props?.['id']
        if (typeof id !== 'string') return
        const found = markersRef.current.find((m) => m.id === id)
        if (found) setSelected(found)
      })

      map.on('mouseenter', DOORS_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', DOORS_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('error', (e) => {
        // Tile failures are routine offline and must not blank the screen.
        // Only a map that never became usable is worth falling back over.
        if (!mapRef.current?.isStyleLoaded()) onFailed()
        else console.warn('[map]', e.error?.message ?? e)
      })
    },
    [onFailed, paintLayers],
  )

  useEffect(
    () => () => {
      mapRef.current?.remove()
      mapRef.current = null
    },
    [],
  )

  /** Doors change as they are knocked; the map updates in place. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource(DOORS_SOURCE)
    if (source && 'setData' in source) {
      ;(source as mapboxgl.GeoJSONSource).setData(markersToGeoJson(markers) as never)
    }
  }, [markers, ready])

  const switchStyle = (key: MapStyleKey) => {
    setStyle(key)
    mapRef.current?.setStyle(`mapbox://styles/${MAP_STYLES[key].id}`)
  }

  const fit = () => {
    const map = mapRef.current
    const bounds = workingBounds(markersRef.current)
    if (!map || !bounds) return
    const padded = padBounds(bounds, 0.05)
    map.fitBounds(
      [
        [padded.west, padded.south],
        [padded.east, padded.north],
      ],
      { padding: 28 },
    )
  }

  return (
    <>
      <SectionTitle hint={`${markers.length} on the map`}>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div className="relative h-96 w-full overflow-hidden">
          {/*
            Inline positioning, not a class, and this is not a style choice.

            Mapbox adds `mapboxgl-map` to whatever element it is given, and its
            stylesheet says `.mapboxgl-map { position: relative }`. That is a
            single-class selector, exactly like Tailwind's `.absolute`, so the
            tie is broken by source order — and because this component is lazy
            loaded, its stylesheet is injected AFTER the app's. Mapbox won,
            `inset-0` stopped applying to a relatively positioned box, the
            container collapsed to zero height, and the map rendered nothing
            while every other sign of life (style loaded, glyphs fetched,
            controls created) looked healthy.

            An inline style cannot be overridden by any stylesheet, whatever
            order it arrives in.
          */}
          <div ref={attachMap} style={{ position: 'absolute', inset: 0 }} />

          <div className="pointer-events-auto absolute left-2 top-2 z-10 flex overflow-hidden rounded-lg ring-1 ring-black/15">
            {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
              <button
                key={key}
                onClick={() => switchStyle(key)}
                className={`px-2.5 py-1 text-[11px] font-semibold ${
                  style === key ? 'bg-brand-primary text-text-primary' : 'bg-bg-elevated text-brand-950'
                }`}
              >
                {MAP_STYLES[key].label}
              </button>
            ))}
          </div>

          <button
            onClick={fit}
            className="absolute right-2 top-2 z-10 rounded-lg bg-bg-elevated px-2.5 py-1 text-[11px] font-semibold text-brand-950 ring-1 ring-black/15"
          >
            Fit
          </button>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle px-3 py-2">
          {LEGEND.map((l) => (
            <span key={l.status} className="flex items-center gap-1.5 text-[10.5px] text-text-secondary">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: LEGEND_COLOUR[l.status] }}
              />
              {l.label}
            </span>
          ))}
        </div>

        {selected && (
          <div className="border-t border-border-subtle px-3 py-2.5">
            <p className="truncate text-[13px] text-text-secondary">{selected.label}</p>
            <p className="mt-0.5 text-[11px] text-text-secondary">
              {selected.status === 'door'
                ? 'Not knocked yet'
                : STATUS_LABEL[selected.status as LeadStatus]}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="contents"
              >
                <Button variant="secondary">Navigate</Button>
              </a>
              {selected.leadId ? (
                <Button variant="gold" onClick={() => onOpenLead(selected.leadId as string)}>
                  Open lead
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setSelected(null)}>
                  Close
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
