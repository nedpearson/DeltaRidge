import { useEffect, useMemo, useRef, useState } from 'react'
import {
  padBounds,
  project,
  viewForBounds,
  workingBounds,
  type GeoPoint,
  type Size,
} from '@/features/leads/map-projection'
import { BASEMAP_ATTRIBUTION, MAP_STYLES, basemapUrl, hasBasemap, type MapStyleKey } from '@/features/leads/basemap'
import { segmentsOf } from '@/features/routes/tracking'
import type { RoutePoint } from '@/features/routes/route-store'

/**
 * A route drawn over a street or satellite image.
 *
 * The one rule that governs every line on this map: a segment is drawn solid
 * only where fixes exist on both ends and nothing was missing in between.
 * Where the trail went quiet the line is dashed and pale, and it is dashed
 * because it is NOT evidence — it is two known positions with an unknown
 * journey between them. A solid line there would be the map asserting a route
 * nobody's phone recorded, which is the single most believable lie this
 * feature could tell.
 */

export interface RouteMarker {
  id: string
  latitude: number
  longitude: number
  colour: string
  label: string
  /** Drawn with a ring when the playhead has reached it. */
  reached: boolean
}

const GAP_COLOUR = '#94a3b8'
const TRAIL_COLOUR = '#2563eb'

export default function RouteMap({
  points,
  markers = [],
  /** Everything at or before this instant is drawn as travelled. */
  through,
  style,
  onStyleChange,
  height = 320,
}: {
  points: readonly RoutePoint[]
  markers?: readonly RouteMarker[]
  through?: string | undefined
  style: MapStyleKey
  onStyleChange?: (style: MapStyleKey) => void
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height })

  useEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [height])

  const geo: GeoPoint[] = useMemo(
    () => [
      ...points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      ...markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
    ],
    [points, markers],
  )

  const view = useMemo(() => {
    const bounds = workingBounds(geo)
    if (!bounds || size.width <= 0) return null
    return viewForBounds(padBounds(bounds, 0.12), size)
  }, [geo, size])

  const segments = useMemo(() => segmentsOf(points), [points])
  const cutoff = through ? Date.parse(through) : Number.POSITIVE_INFINITY

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center">
        <p className="font-display text-sm tracking-wide text-[var(--color-ink)]/">No trail for this route</p>
        <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-[var(--color-ink)]/">
          The route was recorded but no GPS fixes reached the server. The doors and their outcomes are
          still on the timeline; there is simply nothing to draw.
        </p>
      </div>
    )
  }

  const image = view && hasBasemap() ? basemapUrl(view, size, style) : null

  return (
    <div>
      <div
        ref={box}
        className="relative overflow-hidden rounded-2xl bg-[var(--color-surface-3)] ring-1 ring-slate-200"
        style={{ height }}
      >
        {image && (
          <img
            src={image}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            // A basemap that fails to load must never take the trail with it.
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        )}

        {view && size.width > 0 && (
          <svg className="absolute inset-0" width={size.width} height={size.height}>
            {segments.map((segment, index) => {
              const a = project(segment.from, view, size)
              const b = project(segment.to, view, size)
              const travelled = Date.parse(segment.to.recordedAt) <= cutoff
              return (
                <line
                  key={index}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={segment.gap ? GAP_COLOUR : TRAIL_COLOUR}
                  strokeWidth={segment.gap ? 2 : 3.5}
                  strokeLinecap="round"
                  // Dashed where nothing was recorded. See the note at the top.
                  strokeDasharray={segment.gap ? '3 6' : undefined}
                  opacity={travelled ? (segment.gap ? 0.45 : 0.95) : 0.12}
                />
              )
            })}

            {markers.map((marker) => {
              const at = project(marker, view, size)
              return (
                <g key={marker.id} opacity={marker.reached ? 1 : 0.25}>
                  <circle cx={at.x} cy={at.y} r={7} fill="#ffffff" opacity={0.85} />
                  <circle cx={at.x} cy={at.y} r={5} fill={marker.colour} />
                </g>
              )
            })}

            {(() => {
              const first = points[0]
              if (!first) return null
              const at = project(first, view, size)
              return (
                <g>
                  <circle cx={at.x} cy={at.y} r={8} fill="#ffffff" />
                  <circle cx={at.x} cy={at.y} r={5} fill="#0f766e" />
                </g>
              )
            })()}

            {(() => {
              // The playhead: the last fix at or before the cutoff. Never
              // interpolated between two fixes — a smoothly gliding marker
              // would be showing positions nobody recorded.
              const reached = points.filter((p) => Date.parse(p.recordedAt) <= cutoff)
              const here = reached[reached.length - 1]
              if (!here || !through) return null
              const at = project(here, view, size)
              return (
                <g>
                  <circle cx={at.x} cy={at.y} r={12} fill="#f59e0b" opacity={0.25} />
                  <circle cx={at.x} cy={at.y} r={6} fill="#f59e0b" stroke="#ffffff" strokeWidth={2} />
                </g>
              )
            })()}
          </svg>
        )}

        {onStyleChange && (
          <div className="absolute right-2 top-2 flex gap-1 rounded-lg bg-black/55 p-1 backdrop-blur-sm">
            {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
              <button
                key={key}
                onClick={() => onStyleChange(key)}
                className={`rounded px-2 py-1 text-[11px] font-medium ${
                  style === key ? 'bg-slate-200 text-white' : 'text-[var(--color-ink)]/'
                }`}
              >
                {MAP_STYLES[key].label}
              </button>
            ))}
          </div>
        )}

        {!image && (
          <div className="absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-[10px] text-[var(--color-ink)]/">
            No basemap configured — the trail is drawn on its own.
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--color-ink)]/">
        Dashed grey is a stretch with no recorded fixes. It is drawn as a gap rather than a path because
        nothing was recorded there. {image ? BASEMAP_ATTRIBUTION : ''}
      </p>
    </div>
  )
}
