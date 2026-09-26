import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { basemapUrl, hasBasemap, MAP_STYLES, type MapStyleKey } from '@/features/leads/basemap'
import {
  offsetCenter,
  padBounds,
  project,
  spanMiles,
  viewForBounds,
  workingBounds,
  zoomBy,
  type GeoPoint,
  type Size,
  type View,
} from '@/features/leads/map-projection'
import { STATUS_LABEL, type LeadStatus, type ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'
import { northEdge } from '@/features/leads/search-area'

/**
 * The fallback map: one static image, no map library.
 *
 * This was the main map until a rep tried to use it. A single raster cannot
 * pan under a finger or pinch to zoom — every movement is a round trip — and
 * a canvassing map that does not move the way every other map on the phone
 * moves is not a map, it is a picture. `LeadMapLive` is the real one now.
 *
 * This is kept because it still wins in the one case the live map cannot
 * serve: no signal, no WebGL, or no token. A rep in a dead spot gets dots and
 * whatever image was cached rather than a grey box.
 */

/** Until the container has been measured. Replaced on first layout. */
const FALLBACK_SIZE: Size = { width: 320, height: 260 }

interface Marker {
  id: string
  point: GeoPoint
  status: LeadStatus | 'door'
  label: string
  leadId?: string
}

/**
 * Chosen to sit on a LIGHT street map. The previous set was tuned for the dark
 * style and would disappear against a white road, which is the one place a dot
 * has to be legible.
 */
const COLOUR: Record<LeadStatus | 'door', string> = {
  door: '#475569',
  new: '#475569',
  attempted: '#d97706',
  follow_up: '#d97706',
  need_visit: '#2563eb',
  appointment: '#059669',
  inspected: '#059669',
  not_interested: '#dc2626',
  // Grey, not red. A door that was never a prospect is not a rejection, and a
  // map that paints the two the same colour tells a manager the neighbourhood
  // is hostile when it is simply already re-roofed.
  disqualified: '#64748b',
  do_not_knock: '#dc2626',
}

/** The legend sits on the app's dark card, where slate-600 is too dim. */
const LEGEND_COLOUR: Record<LeadStatus | 'door', string> = {
  ...COLOUR,
  door: '#94a3b8',
}

const LEGEND: { status: LeadStatus | 'door'; label: string }[] = [
  { status: 'door', label: 'Not knocked' },
  { status: 'follow_up', label: 'Owed a visit' },
  { status: 'need_visit', label: 'Wants a look' },
  { status: 'appointment', label: 'Booked' },
  { status: 'do_not_knock', label: 'Off the list' },
]

export default function LeadMapStatic({
  doors,
  leads,
  storms,
  searchCenter = null,
  searchRadiusMiles = 3,
  onOpenLead,
}: {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  searchCenter?: { latitude: number; longitude: number; accuracyMeters?: number } | null
  searchRadiusMiles?: number
  onOpenLead: (leadId: string) => void
}) {
  const [size, setSize] = useState<Size>(FALLBACK_SIZE)
  const observerRef = useRef<ResizeObserver | null>(null)

  /**
   * The rendered size drives both the image request and the projection, so it
   * has to be measured, not guessed — and re-measured on rotation or resize.
   *
   * A callback ref rather than useRef + useEffect, because this component
   * returns early before the map exists while the door list is still loading.
   * An effect with an empty dependency list runs once, during that early
   * return, finds no element, and never runs again — which is exactly the bug
   * that left every request stuck at the 320x260 fallback and the street names
   * stretched across a desktop.
   */
  const attachBox = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) return
      setSize((s) =>
        Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1
          ? s
          : { width: Math.round(width), height: Math.round(height) },
      )
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const markers: Marker[] = useMemo(() => {
    // Leads first: a door that has become somebody must not be drawn twice,
    // and the pipeline colour is the one that matters.
    const promoted = new Set(leads.map((l) => l.addressKey))
    return [
      ...leads.map(
        (l): Marker => ({
          id: l.id,
          point: l,
          status: l.status,
          label: l.contactName ? `${l.contactName} — ${l.address}` : l.address,
          leadId: l.id,
        }),
      ),
      ...doors
        .filter((d) => !promoted.has(d.addressKey))
        .map((d): Marker => ({ id: d.addressKey, point: d, status: 'door', label: d.address })),
    ]
  }, [doors, leads])

  const fitted = useMemo(() => {
    const points = [
      ...markers.map((m) => m.point),
      ...(searchCenter ? [searchCenter, northEdge(searchCenter, searchRadiusMiles)] : []),
    ]
    const base = workingBounds(points)
    return base ? viewForBounds(padBounds(base), size) : null
  }, [markers, searchCenter, searchRadiusMiles, size])

  const [view, setView] = useState<View | null>(null)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [selected, setSelected] = useState<Marker | null>(null)
  const [style, setStyle] = useState<MapStyleKey>('streets')
  const [tilesFailed, setTilesFailed] = useState(false)
  const from = useRef<{ x: number; y: number } | null>(null)

  const current = view ?? fitted

  if (!fitted || !current) {
    return (
      <>
        <SectionTitle>MAP</SectionTitle>
        <Card>
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            Nothing to plot yet. Build the door list and the map fills in.
          </p>
        </Card>
      </>
    )
  }

  const tiles = tilesFailed ? null : basemapUrl(current, size, style)
  const onSatellite = style === 'satellite'

  const placed = markers.map((m) => ({ marker: m, ...project(m.point, current, size) }))
  const searchCenterPoint = searchCenter ? project(searchCenter, current, size) : null
  const searchNorthPoint = searchCenter ? project(northEdge(searchCenter, searchRadiusMiles), current, size) : null
  const searchRadiusPx =
    searchCenterPoint && searchNorthPoint
      ? Math.abs(searchCenterPoint.y - searchNorthPoint.y)
      : 0
  const stormPoints = storms
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => ({ id: s.externalId, ...project(s, current, size), size: s.hailSizeInches ?? 1 }))

  // Arrows rather than function declarations: a hoisted declaration is
  // analysed without the null check above it, and `current` is only known to
  // be a view after that guard.
  const onPointerDown = (e: React.PointerEvent) => {
    from.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const start = from.current
    if (!start) return
    // The image and the overlay are shifted together while the finger is down,
    // and only when it lifts is a new image fetched. Refetching mid-drag costs
    // a request per frame and leaves the streets lagging behind the dots.
    setDrag({ x: e.clientX - start.x, y: e.clientY - start.y })
  }

  const onPointerUp = () => {
    if (!from.current) return
    from.current = null
    if (drag.x === 0 && drag.y === 0) return
    setView({ center: offsetCenter(current, -drag.x, -drag.y), zoom: current.zoom })
    setDrag({ x: 0, y: 0 })
    setTilesFailed(false)
  }

  const recentre = (next: View | null) => {
    setView(next)
    setDrag({ x: 0, y: 0 })
    setTilesFailed(false)
  }

  return (
    <>
      <SectionTitle hint={`${spanMiles(current, size)} mi across`}>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div
          ref={attachBox}
          className="relative h-72 w-full touch-none overflow-hidden bg-bg-elevated"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {tiles && (
            <img
              key={tiles}
              src={tiles}
              alt=""
              draggable={false}
              onError={() => setTilesFailed(true)}
              className="pointer-events-none absolute inset-0 h-full w-full select-none"
              style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}
            />
          )}

          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="absolute inset-0 h-full w-full"
          >
            <g transform={`translate(${drag.x} ${drag.y})`}>
              {searchCenterPoint && searchRadiusPx > 0 && (
                <>
                  <circle
                    cx={searchCenterPoint.x}
                    cy={searchCenterPoint.y}
                    r={searchRadiusPx}
                    fill="#27C6E8"
                    fillOpacity={0.055}
                    stroke="#27C6E8"
                    strokeOpacity={0.7}
                    strokeWidth={2}
                  />
                  <circle
                    cx={searchCenterPoint.x}
                    cy={searchCenterPoint.y}
                    r={6}
                    fill="#27C6E8"
                    stroke="#F7FAFC"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Storm reports underneath: they are context, not the work. */}
              {stormPoints.map((s) => (
                <circle
                  key={s.id}
                  cx={s.x}
                  cy={s.y}
                  r={8 + s.size * 6}
                  fill="#b45309"
                  fillOpacity={0.1}
                  stroke="#b45309"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                />
              ))}

              {placed.map(({ marker, x, y }) => (
                <circle
                  key={marker.id}
                  cx={x}
                  cy={y}
                  r={marker.status === 'door' ? 4 : 5.5}
                  fill={COLOUR[marker.status]}
                  // A white halo, so a dot reads on a pale road, a dark park
                  // and a satellite roof without changing its colour.
                  stroke={selected?.id === marker.id ? '#111827' : '#ffffff'}
                  strokeWidth={selected?.id === marker.id ? 3 : 1.5}
                  onClick={() => setSelected(marker)}
                  className="cursor-pointer"
                />
              ))}
            </g>
          </svg>

          <div className="absolute right-2 top-2 flex overflow-hidden rounded-lg ring-1 ring-black/10">
            {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => (
              <button
                key={key}
                onClick={() => {
                  setStyle(key)
                  setTilesFailed(false)
                }}
                className={`px-2.5 py-1 text-[11px] font-semibold ${
                  style === key ? 'bg-brand-primary text-text-primary' : 'bg-bg-elevated text-brand-950'
                }`}
              >
                {MAP_STYLES[key].label}
              </button>
            ))}
          </div>

          <div className="absolute bottom-2 right-2 flex gap-1">
            <button
              onClick={() => recentre(zoomBy(current, -1))}
              className="rounded-lg bg-bg-elevated px-2.5 py-1 text-[14px] font-semibold text-brand-950 ring-1 ring-black/10"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => recentre(zoomBy(current, 1))}
              className="rounded-lg bg-bg-elevated px-2.5 py-1 text-[14px] font-semibold text-brand-950 ring-1 ring-black/10"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => recentre(null)}
              className="rounded-lg bg-bg-elevated px-2.5 py-1 text-[11px] font-semibold text-brand-950 ring-1 ring-black/10"
            >
              Fit
            </button>
          </div>
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
              {selected.status === 'door' ? 'Not knocked yet' : STATUS_LABEL[selected.status]}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.point.latitude},${selected.point.longitude}`}
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

        {!hasBasemap() && (
          <p className="border-t border-border-subtle px-3 py-2 text-[10.5px] leading-relaxed text-text-secondary">
            Positions only — there are no streets under these dots. Add a Mapbox public token as
            VITE_MAPBOX_PUBLIC_TOKEN and the street map appears here.
          </p>
        )}
        {hasBasemap() && tilesFailed && (
          <p className="border-t border-border-subtle px-3 py-2 text-[10.5px] leading-relaxed text-status-warning/70">
            The {onSatellite ? 'satellite' : 'street'} map could not load, so this is positions
            only. The dots are still right.
          </p>
        )}
      </Card>
    </>
  )
}
