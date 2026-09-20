import { useMemo, useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import {
  boundsOf,
  padBounds,
  project,
  spanMiles,
  type GeoPoint,
} from '@/features/leads/map-projection'
import { STATUS_LABEL, type LeadStatus, type ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'

/**
 * Where the work is, coloured by what happened there.
 *
 * No basemap, and that is the design rather than a shortfall. Street tiles
 * need a Mapbox token this deployment does not have and a network round trip a
 * rep in a truck often will not get. What a rep needs standing in a driveway
 * is which houses on this street are done, which are owed a second visit and
 * which were never knocked — and that is the shape of the dots, not the
 * streets under them.
 *
 * If a token is ever added, this is the layer that sits on top of tiles; the
 * projection is already the one a slippy map uses at this scale.
 */

const VIEW = { width: 320, height: 240 }

type Marker = {
  id: string
  point: GeoPoint
  status: LeadStatus | 'door'
  label: string
  leadId?: string
}

const COLOUR: Record<LeadStatus | 'door', string> = {
  door: '#6b7280',
  new: '#6b7280',
  attempted: '#f0b429',
  follow_up: '#f0b429',
  need_visit: '#4f8ef7',
  appointment: '#34d399',
  inspected: '#34d399',
  not_interested: '#7f1d1d',
  do_not_knock: '#7f1d1d',
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
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selected, setSelected] = useState<Marker | null>(null)
  const dragging = useRef<{ x: number; y: number } | null>(null)

  const markers: Marker[] = useMemo(() => {
    // Leads first: a door that has become somebody must not be drawn twice,
    // and the pipeline colour is the one that matters.
    const byAddress = new Set(leads.map((l) => l.addressKey))
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
        .filter((d) => !byAddress.has(d.addressKey))
        .map(
          (d): Marker => ({
            id: d.addressKey,
            point: d,
            status: 'door',
            label: d.address,
          }),
        ),
    ]
  }, [doors, leads])

  const bounds = useMemo(() => {
    const base = boundsOf(markers.map((m) => m.point))
    return base ? padBounds(base) : null
  }, [markers])

  if (!bounds) {
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

  const stormPoints = storms
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => ({ id: s.externalId, ...project(s, bounds, VIEW), size: s.hailSizeInches ?? 1 }))

  const placed = markers.map((m) => ({ marker: m, ...project(m.point, bounds, VIEW) }))

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragging.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const from = dragging.current
    if (!from) return
    // Divided by zoom so a drag moves the same distance under the finger
    // whatever the magnification, which is what makes it feel like paper.
    setPan((p) => ({
      x: p.x + (e.clientX - from.x) / zoom,
      y: p.y + (e.clientY - from.y) / zoom,
    }))
    dragging.current = { x: e.clientX, y: e.clientY }
  }

  function onPointerUp() {
    dragging.current = null
  }

  return (
    <>
      <SectionTitle hint={`${spanMiles(bounds)} mi across`}>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="block h-60 w-full touch-none bg-[#0b1220]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g
            transform={`translate(${VIEW.width / 2} ${VIEW.height / 2}) scale(${zoom}) translate(${
              -VIEW.width / 2 + pan.x
            } ${-VIEW.height / 2 + pan.y})`}
          >
            {/* Storm reports underneath: they are context, not the work. */}
            {stormPoints.map((s) => (
              <circle
                key={s.id}
                cx={s.x}
                cy={s.y}
                r={6 + s.size * 4}
                fill="#f0b429"
                fillOpacity={0.07}
                stroke="#f0b429"
                strokeOpacity={0.25}
                strokeWidth={0.5}
              />
            ))}

            {placed.map(({ marker, x, y }) => (
              <circle
                key={marker.id}
                cx={x}
                cy={y}
                r={marker.status === 'door' ? 2 : 3.4}
                fill={COLOUR[marker.status]}
                fillOpacity={marker.status === 'door' ? 0.75 : 1}
                stroke={selected?.id === marker.id ? '#ffffff' : 'none'}
                strokeWidth={selected?.id === marker.id ? 1.4 : 0}
                onClick={() => setSelected(marker)}
                className="cursor-pointer"
              />
            ))}
          </g>
        </svg>

        <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3 py-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {LEGEND.map((l) => (
              <span key={l.status} className="flex items-center gap-1.5 text-[10.5px] text-white/45">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: COLOUR[l.status] }}
                />
                {l.label}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(1, z / 1.6))}
              className="rounded-lg bg-white/8 px-2.5 py-1 text-[13px] text-white/70"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(12, z * 1.6))}
              className="rounded-lg bg-white/8 px-2.5 py-1 text-[13px] text-white/70"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
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

        <p className="border-t border-white/8 px-3 py-2 text-[10.5px] leading-relaxed text-white/25">
          Positions only — there are no streets under these dots. A street basemap needs a Mapbox
          public token, which this deployment does not have, and would not load with no signal.
        </p>
      </Card>
    </>
  )
}
