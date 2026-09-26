import { useEffect, useMemo, useRef, useState } from 'react'
import { eagleViewMapConfig, eagleViewTile, type EagleViewMapConfig } from '@/features/imagery/eagleview-map'
import { segmentsOf } from '@/features/routes/tracking'
import type { RoutePoint } from '@/features/routes/route-store'

export interface RouteMarker {
  id: string
  latitude: number
  longitude: number
  colour: string
  label: string
  reached: boolean
}

const TILE = 256
const MAX_LAT = 85.05112878
const GAP_COLOUR = '#94a3b8'
const TRAIL_COLOUR = '#27C6E8'

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function xWorld(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * TILE * 2 ** zoom
}

function yWorld(latitude: number, zoom: number): number {
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT) * Math.PI / 180
  return (
    0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)
  ) * TILE * 2 ** zoom
}

function fit(
  points: readonly { latitude: number; longitude: number }[],
  width: number,
  height: number,
): { latitude: number; longitude: number; zoom: number } | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null
  const lats = points.map((p) => p.latitude)
  const lons = points.map((p) => p.longitude)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const latitude = (south + north) / 2
  const longitude = (west + east) / 2

  for (let zoom = 20; zoom >= 2; zoom -= 1) {
    const spanX = Math.abs(xWorld(east, zoom) - xWorld(west, zoom))
    const spanY = Math.abs(yWorld(south, zoom) - yWorld(north, zoom))
    if (spanX <= width * 0.78 && spanY <= height * 0.78) {
      return { latitude, longitude, zoom }
    }
  }
  return { latitude, longitude, zoom: 2 }
}

function Tile({
  z,
  x,
  y,
  left,
  top,
}: {
  z: number
  x: number
  y: number
  left: number
  top: number
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    void eagleViewTile(z, x, y)
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (active) setUrl(null)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [z, x, y])

  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute size-64 select-none object-cover"
      style={{ left, top }}
    />
  ) : null
}

export default function RouteMap({
  points,
  markers = [],
  through,
  height = 320,
}: {
  points: readonly RoutePoint[]
  markers?: readonly RouteMarker[]
  through?: string | undefined
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height })
  const [config, setConfig] = useState<EagleViewMapConfig | null>(null)

  useEffect(() => {
    void eagleViewMapConfig().then(setConfig)
  }, [])

  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({ width: Math.max(1, Math.round(entry.contentRect.width)), height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [height])

  const geo = useMemo(
    () => [
      ...points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      ...markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
    ],
    [points, markers],
  )

  const view = useMemo(() => fit(geo, size.width, size.height), [geo, size])
  const segments = useMemo(() => segmentsOf(points), [points])
  const cutoff = through ? Date.parse(through) : Number.POSITIVE_INFINITY

  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-subtle px-5 py-10 text-center">
        <p className="font-display text-sm tracking-wide text-text-secondary">No trail for this route</p>
        <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-text-secondary">
          The route was recorded but no GPS fixes reached the server. The timeline remains available.
        </p>
      </div>
    )
  }

  if (!view) return null

  const zoom = clamp(Math.round(view.zoom), config?.minZoom ?? 1, config?.maxZoom ?? 22)
  const centerX = xWorld(view.longitude, zoom)
  const centerY = yWorld(view.latitude, zoom)
  const leftWorld = centerX - size.width / 2
  const topWorld = centerY - size.height / 2
  const minTileX = Math.floor(leftWorld / TILE) - 1
  const maxTileX = Math.floor((leftWorld + size.width) / TILE) + 1
  const minTileY = Math.floor(topWorld / TILE) - 1
  const maxTileY = Math.floor((topWorld + size.height) / TILE) + 1
  const tileCount = 2 ** zoom
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = []

  if (config?.configured) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (y < 0 || y >= tileCount) continue
      for (let x = minTileX; x <= maxTileX; x += 1) {
        tiles.push({
          x: ((x % tileCount) + tileCount) % tileCount,
          y,
          left: x * TILE - leftWorld,
          top: y * TILE - topWorld,
        })
      }
    }
  }

  const project = (point: { latitude: number; longitude: number }) => ({
    x: xWorld(point.longitude, zoom) - leftWorld,
    y: yWorld(point.latitude, zoom) - topWorld,
  })

  return (
    <div>
      <div
        ref={box}
        className="relative overflow-hidden rounded-2xl bg-bg-elevated ring-1 ring-border-subtle"
        style={{ height }}
      >
        {tiles.map((tile) => (
          <Tile
            key={String(zoom) + '/' + String(tile.x) + '/' + String(tile.y)}
            z={zoom}
            x={tile.x}
            y={tile.y}
            left={tile.left}
            top={tile.top}
          />
        ))}

        <svg className="absolute inset-0" width={size.width} height={size.height}>
          {segments.map((segment, index) => {
            const a = project(segment.from)
            const b = project(segment.to)
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
                strokeDasharray={segment.gap ? '3 6' : undefined}
                opacity={travelled ? (segment.gap ? 0.45 : 0.95) : 0.12}
              />
            )
          })}

          {markers.map((marker) => {
            const at = project(marker)
            return (
              <g key={marker.id} opacity={marker.reached ? 1 : 0.25}>
                <circle cx={at.x} cy={at.y} r={7} fill="#ffffff" opacity={0.85} />
                <circle cx={at.x} cy={at.y} r={5} fill={marker.colour} />
              </g>
            )
          })}

          {points[0] && (() => {
            const at = project(points[0])
            return (
              <g>
                <circle cx={at.x} cy={at.y} r={8} fill="#ffffff" />
                <circle cx={at.x} cy={at.y} r={5} fill="#27C6E8" />
              </g>
            )
          })()}

          {through && (() => {
            const reached = points.filter((point) => Date.parse(point.recordedAt) <= cutoff)
            const here = reached[reached.length - 1]
            if (!here) return null
            const at = project(here)
            return (
              <g>
                <circle cx={at.x} cy={at.y} r={12} fill="#D9A441" opacity={0.25} />
                <circle cx={at.x} cy={at.y} r={6} fill="#D9A441" stroke="#ffffff" strokeWidth={2} />
              </g>
            )
          })()}
        </svg>

        {!config?.configured && (
          <div className="absolute bottom-2 left-2 max-w-[80%] rounded bg-bg-elevated px-2 py-1 text-[10px] text-text-secondary ring-1 ring-border-subtle">
            EagleView WMTS unavailable — route evidence is still drawn from recorded GPS fixes.
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-secondary">
        EagleView ortho imagery is the in-app basemap when entitled. Dashed grey means no GPS fixes were recorded between those two points.
      </p>
    </div>
  )
}
