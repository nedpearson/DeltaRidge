import { useMemo, useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { basemapUrl, hasBasemap } from '@/features/leads/basemap'
import {
  boundsOf,
  offsetCenter,
  padBounds,
  project,
  spanMiles,
  viewForBounds,
  zoomBy,
  type GeoPoint,
  type View,
} from '@/features/leads/map-projection'
import { STATUS_LABEL, type LeadStatus, type ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'

/**
 * Where the work is, coloured by what happened there.
 *
 * Streets come from one Mapbox static image, not a map library: a single
 * request instead of a tile stream, and a plain `<img>` that can fail without
 * taking the screen with it. With no token and no signal the dots are still
 * there, which is the case that matters — a rep in a truck with one bar needs
 * to know which houses on this street are done, and that is the shape of the
 * dots rather than the streets under them.
 *
 * The overlay projects with exactly the centre and zoom the image was
 * requested at, so a door sits on its own roof rather than near it.
 */

const VIEW_SIZE = { width: 320, height: 240 }

interface Marker {
  id: string
  point: GeoPoint
  status: LeadStatus | 'door'
  label: string
  leadId?: string
}

const COLOUR: Record<LeadStatus | 'door', string> = {
  door: '#9aa3b2',
  new: '#9aa3b2',
  attempted: '#f0b429',
  follow_up: '#f0b429',
  need_visit: '#4f8ef7',
  appointment: '#34d399',
  inspected: '#34d399',
  not_interested: '#ef4444',
  do_not_knock: '#ef4444',
}

const LEGEND: { status: LeadStatus | 'door'; label: string }[] = [
  { status: 'door', label: 'Not knocked' },
  { status: 'follow_up', label: 'Owed a visit' },
  { status: 'need_visit', label: 'Wants a look' },
  { status: 'appointment', label: 'Booked' },
  { status: 'do_not_knock', label: 'Off the list' },
]

export default function LeadMap({
  doors,
  leads,
  storms,
  onOpenLead,
}: {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  onOpenLead: (leadId: string) => void
}) {
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
    const base = boundsOf(markers.map((m) => m.point))
    return base ? viewForBounds(padBounds(base), VIEW_SIZE) : null
  }, [markers])

  const [view, setView] = useState<View | null>(null)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [selected, setSelected] = useState<Marker | null>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  const from = useRef<{ x: number; y: number } | null>(null)

  const current = view ?? fitted

  if (!fitted || !current) {
    return (
      <>
        <SectionTitle>MAP</SectionTitle>
        <Card>
          <p className="text-[12.5px] leading-relaxed text-white/45">
            Nothing to plot yet. Build the door list and the map fills in.
          </p>
        </Card>
      </>
    )
  }

  const tiles = tilesFailed ? null : basemapUrl(current, VIEW_SIZE)

  const placed = markers.map((m) => ({ marker: m, ...project(m.point, current, VIEW_SIZE) }))
  const stormPoints = storms
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => ({ id: s.externalId, ...project(s, current, VIEW_SIZE), size: s.hailSizeInches ?? 1 }))

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
    // The image and the overlay are shifted together by the same pixels while
    // the finger is down, and only when it lifts is a new image fetched. The
    // alternative — refetching mid-drag — costs a request per frame and makes
    // the streets lag behind the dots.
    const rect = e.currentTarget.getBoundingClientRect()
    const perPixel = VIEW_SIZE.width / rect.width
    setDrag({ x: (e.clientX - start.x) * perPixel, y: (e.clientY - start.y) * perPixel })
  }

  const onPointerUp = () => {
    if (!from.current) return
    from.current = null
    if (drag.x === 0 && drag.y === 0) return
    setView({ center: offsetCenter(current, -drag.x, -drag.y), zoom: current.zoom })
    setDrag({ x: 0, y: 0 })
    setTilesFailed(false)
  }

  return (
    <>
      <SectionTitle hint={`${spanMiles(current, VIEW_SIZE)} mi across`}>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div
          className="relative h-60 w-full touch-none overflow-hidden bg-[#0b1220]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {tiles && (
            <img
              src={tiles}
              alt=""
              draggable={false}
              onError={() => setTilesFailed(true)}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover opacity-80"
              style={{
                transform: `translate(${(drag.x / VIEW_SIZE.width) * 100}%, ${
                  (drag.y / VIEW_SIZE.height) * 100
                }%)`,
              }}
            />
          )}

          <svg
            viewBox={`0 0 ${VIEW_SIZE.width} ${VIEW_SIZE.height}`}
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 h-full w-full"
          >
            <g transform={`translate(${drag.x} ${drag.y})`}>
              {/* Storm reports underneath: they are context, not the work. */}
              {stormPoints.map((s) => (
                <circle
                  key={s.id}
                  cx={s.x}
                  cy={s.y}
                  r={6 + s.size * 4}
                  fill="#f0b429"
                  fillOpacity={0.08}
                  stroke="#f0b429"
                  strokeOpacity={0.3}
                  strokeWidth={0.5}
                />
              ))}

              {placed.map(({ marker, x, y }) => (
                <circle
                  key={marker.id}
                  cx={x}
                  cy={y}
                  r={marker.status === 'door' ? 2.2 : 3.6}
                  fill={COLOUR[marker.status]}
                  fillOpacity={marker.status === 'door' ? 0.85 : 1}
                  // A thin dark ring keeps every dot readable over a pale road
                  // or a dark park without changing its colour.
                  stroke={selected?.id === marker.id ? '#ffffff' : '#0b1220'}
                  strokeWidth={selected?.id === marker.id ? 1.4 : 0.6}
                  onClick={() => setSelected(marker)}
                  className="cursor-pointer"
                />
              ))}
            </g>
          </svg>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3 py-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {LEGEND.map((l) => (
              <span key={l.status} className="flex items-center gap-1.5 text-[10.5px] text-white/45">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: COLOUR[l.status] }} />
                {l.label}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => {
                setView(zoomBy(current, -1))
                setTilesFailed(false)
              }}
              className="rounded-lg bg-white/8 px-2.5 py-1 text-[13px] text-white/70"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => {
                setView(zoomBy(current, 1))
                setTilesFailed(false)
              }}
              className="rounded-lg bg-white/8 px-2.5 py-1 text-[13px] text-white/70"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => {
                setView(null)
                setDrag({ x: 0, y: 0 })
                setTilesFailed(false)
              }}
              className="rounded-lg bg-white/8 px-2.5 py-1 text-[11px] text-white/55"
            >
              Fit
            </button>
          </div>
        </div>

        {selected && (
          <div className="border-t border-white/8 px-3 py-2.5">
            <p className="truncate text-[13px] text-white/80">{selected.label}</p>
            <p className="mt-0.5 text-[11px] text-white/35">
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
          <p className="border-t border-white/8 px-3 py-2 text-[10.5px] leading-relaxed text-white/25">
            Positions only — there are no streets under these dots. Add a Mapbox public token as
            VITE_MAPBOX_PUBLIC_TOKEN and the street map appears here.
          </p>
        )}
        {hasBasemap() && tilesFailed && (
          <p className="border-t border-white/8 px-3 py-2 text-[10.5px] leading-relaxed text-amber-200/70">
            The street map could not load, so this is positions only. The dots are still right.
          </p>
        )}
      </Card>
    </>
  )
}
