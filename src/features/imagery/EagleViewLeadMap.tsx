import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'
import { LEGEND, LEGEND_COLOUR, markersFor, type Marker } from '@/features/leads/markers'
import { eagleViewMapConfig, eagleViewTile, type EagleViewMapConfig } from './eagleview-map'
import type { SearchCenter } from '@/features/leads/search-area'

const TILE = 256
const MAX_LAT = 85.05112878

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function xWorld(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * TILE * 2 ** zoom
}

function yWorld(latitude: number, zoom: number): number {
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT) * Math.PI / 180
  const normalized = 0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)
  return normalized * TILE * 2 ** zoom
}

function lonFromWorld(x: number, zoom: number): number {
  return (x / (TILE * 2 ** zoom)) * 360 - 180
}

function latFromWorld(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** zoom)
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

function metresPerPixel(latitude: number, zoom: number): number {
  return 156543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom
}

function fit(markers: readonly Marker[], width: number, height: number) {
  if (markers.length === 0 || width <= 0 || height <= 0) {
    return { latitude: 30.4515, longitude: -91.1871, zoom: 12 }
  }
  const lats = markers.map((m) => m.latitude)
  const lons = markers.map((m) => m.longitude)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const latitude = (south + north) / 2
  const longitude = (west + east) / 2

  for (let zoom = 20; zoom >= 2; zoom -= 1) {
    const spanX = Math.abs(xWorld(east, zoom) - xWorld(west, zoom))
    const spanY = Math.abs(yWorld(south, zoom) - yWorld(north, zoom))
    if (spanX <= width * 0.82 && spanY <= height * 0.82) return { latitude, longitude, zoom }
  }
  return { latitude, longitude, zoom: 2 }
}

function Tile(props: { z: number; x: number; y: number; left: number; top: number }) {
  const { z, x, y, left, top } = props
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

  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute size-64 select-none object-cover"
      style={{ left, top }}
    />
  )
}

export default function EagleViewLeadMap({
  doors,
  leads,
  storms,
  searchCenter,
  searchRadiusMiles,
  onOpenLead,
}: {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  searchCenter?: SearchCenter
  searchRadiusMiles?: number
  onOpenLead: (leadId: string) => void
}) {
  const markers = useMemo(() => markersFor(doors, leads), [doors, leads])
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 384 })
  const [config, setConfig] = useState<EagleViewMapConfig | null>(null)
  const [selected, setSelected] = useState<Marker | null>(null)
  const [manualView, setManualView] = useState<{ latitude: number; longitude: number; zoom: number } | null>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  useEffect(() => {
    void eagleViewMapConfig().then(setConfig)
  }, [])

  useEffect(() => {
    const node = box.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const fitted = useMemo(
    () =>
      markers.length === 0 && searchCenter
        ? {
            latitude: searchCenter.latitude,
            longitude: searchCenter.longitude,
            zoom: 13,
          }
        : fit(markers, size.width, size.height),
    [markers, size, searchCenter],
  )
  const view = manualView ?? fitted
  const zoom = clamp(Math.round(view.zoom), config?.minZoom ?? 1, config?.maxZoom ?? 22)
  const worldX = xWorld(view.longitude, zoom)
  const worldY = yWorld(view.latitude, zoom)
  const leftWorld = worldX - size.width / 2
  const topWorld = worldY - size.height / 2

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
        const wrappedX = ((x % tileCount) + tileCount) % tileCount
        tiles.push({
          x: wrappedX,
          y,
          left: x * TILE - leftWorld,
          top: y * TILE - topWorld,
        })
      }
    }
  }

  const projected = markers.map((marker) => ({
    marker,
    x: xWorld(marker.longitude, zoom) - leftWorld,
    y: yWorld(marker.latitude, zoom) - topWorld,
  }))

  const stormPoints = storms
    .filter((storm) => Number.isFinite(storm.latitude) && Number.isFinite(storm.longitude))
    .map((storm) => ({
      id: storm.externalId,
      x: xWorld(storm.longitude, zoom) - leftWorld,
      y: yWorld(storm.latitude, zoom) - topWorld,
      radius: 8 + (storm.hailSizeInches ?? 1) * 5,
    }))

  const searchRadiusPx =
    searchCenter && searchRadiusMiles
      ? (searchRadiusMiles * 1609.344) / metresPerPixel(searchCenter.latitude, zoom)
      : null
  const searchCenterPx = searchCenter
    ? {
        x: xWorld(searchCenter.longitude, zoom) - leftWorld,
        y: yWorld(searchCenter.latitude, zoom) - topWorld,
      }
    : null

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, cx: worldX, cy: worldY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    const nextX = start.cx - (event.clientX - start.x)
    const nextY = start.cy - (event.clientY - start.y)
    setManualView({
      longitude: lonFromWorld(nextX, zoom),
      latitude: latFromWorld(nextY, zoom),
      zoom,
    })
  }

  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <>
      <SectionTitle hint={String(markers.length) + ' properties · EagleView ortho WMTS'}>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div
          ref={box}
          className="relative h-96 w-full touch-none overflow-hidden bg-bg-page"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
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

          {!config?.configured && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div>
                <p className="text-[13px] font-semibold text-text-primary">
                  EagleView map imagery is not proven yet.
                </p>
                <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-text-secondary">
                  {config?.message ?? 'Checking the EagleView WMTS entitlement…'} Property coordinates and workflow remain available.
                </p>
              </div>
            </div>
          )}

          <svg className="pointer-events-none absolute inset-0 size-full">
            {searchCenterPx && searchRadiusPx && (
              <>
                <circle
                  cx={searchCenterPx.x}
                  cy={searchCenterPx.y}
                  r={searchRadiusPx}
                  fill="rgba(39,198,232,.06)"
                  stroke="#27C6E8"
                  strokeOpacity={0.8}
                  strokeWidth={2}
                />
                <circle cx={searchCenterPx.x} cy={searchCenterPx.y} r={5} fill="#27C6E8" stroke="#ffffff" strokeWidth={2} />
              </>
            )}

            {stormPoints.map((storm) => (
              <circle
                key={storm.id}
                cx={storm.x}
                cy={storm.y}
                r={storm.radius}
                fill="rgba(213,139,50,.10)"
                stroke="#D58B32"
                strokeOpacity={0.55}
                strokeWidth={1}
              />
            ))}

            {projected.map(({ marker, x, y }) => (
              <circle
                key={marker.id}
                cx={x}
                cy={y}
                r={marker.status === 'door' ? 5 : 7}
                fill={LEGEND_COLOUR[marker.status]}
                stroke={selected?.id === marker.id ? '#27C6E8' : '#ffffff'}
                strokeWidth={selected?.id === marker.id ? 3 : 1.5}
                className="pointer-events-auto cursor-pointer"
                onClick={() => setSelected(marker)}
              />
            ))}
          </svg>

          <div className="absolute right-2 top-2 flex flex-col gap-1">
            <button
              onClick={() => setManualView({ ...view, zoom: Math.min(config?.maxZoom ?? 22, zoom + 1) })}
              className="size-9 rounded-lg bg-bg-elevated text-lg text-text-primary ring-1 ring-border-subtle"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setManualView({ ...view, zoom: Math.max(config?.minZoom ?? 1, zoom - 1) })}
              className="size-9 rounded-lg bg-bg-elevated text-lg text-text-primary ring-1 ring-border-subtle"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => setManualView(null)}
              className="rounded-lg bg-bg-elevated px-2 py-1 text-[10px] font-semibold text-text-primary ring-1 ring-border-subtle"
            >
              Fit
            </button>
          </div>

          <div className="absolute bottom-2 left-2 rounded bg-bg-elevated px-2 py-1 text-[9.5px] text-text-secondary ring-1 ring-border-subtle">
            EagleView · capture availability varies by location/account
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle px-3 py-2">
          {LEGEND.map((item) => (
            <span key={item.status} className="flex items-center gap-1.5 text-[10.5px] text-text-secondary">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: LEGEND_COLOUR[item.status] }} />
              {item.label}
            </span>
          ))}
        </div>

        {selected && (
          <div className="border-t border-border-subtle px-3 py-2.5">
            <p className="truncate text-[13px] text-text-primary">{selected.label}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a
                href={'https://www.google.com/maps/dir/?api=1&destination=' + String(selected.latitude) + ',' + String(selected.longitude)}
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
                <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
