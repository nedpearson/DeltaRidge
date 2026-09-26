import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card } from '@/components/ui'
import RouteMap, { type RouteMarker } from '@/components/RouteMap'
import type { MapStyleKey } from '@/features/leads/basemap'
import type { RoutePoint, RouteSession } from '@/features/routes/route-store'
import { buildTimeline, type TimelineActivity, type TimelineEntry } from '@/features/routes/timeline'

/**
 * Replaying a field day.
 *
 * The scrubber moves a cutoff instant, and everything on screen is drawn as of
 * that instant: the trail fills in, doors light up as they were recorded, the
 * timeline scrolls. What it deliberately does NOT do is animate a marker
 * gliding between two fixes twenty minutes apart. That motion would be the
 * single most convincing thing on the screen and the least true — the phone
 * reported two positions, and everything between them is the app's invention.
 * The marker therefore sits on the last real fix and jumps when the next one
 * arrives, which looks less slick and is what happened.
 */

const VERIFICATION_COLOUR: Record<string, string> = {
  verified: '#059669',
  probable: '#2563eb',
  unverified: '#d97706',
  gps_unavailable: '#64748b',
}

const KIND_COLOUR: Record<string, string> = {
  knock: '#2563eb',
  appointment: '#059669',
  note: '#64748b',
  stop: '#f59e0b',
  gap_started: '#94a3b8',
  gap_ended: '#94a3b8',
  paused: '#a855f7',
  resumed: '#a855f7',
  route_started: '#0f766e',
  route_ended: '#0f766e',
}

const SPEEDS = [1, 8, 30, 120] as const

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function RoutePlayback({
  session,
  points,
  activities,
}: {
  session: RouteSession
  points: readonly RoutePoint[]
  activities: readonly TimelineActivity[]
}) {
  const [style, setStyle] = useState<MapStyleKey>('streets')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(30)
  const listRef = useRef<HTMLDivElement>(null)

  const timeline = useMemo(
    () => buildTimeline(session, points, activities),
    [session, points, activities],
  )

  const startMs = Date.parse(session.startedAt)
  const endMs = session.endedAt
    ? Date.parse(session.endedAt)
    : Math.max(
        startMs + 60_000,
        ...points.map((p) => Date.parse(p.recordedAt)),
        ...timeline.map((e) => Date.parse(e.at)),
      )
  const span = Math.max(1000, endMs - startMs)

  const [offset, setOffset] = useState(span)
  useEffect(() => setOffset(span), [span])

  const cutoff = new Date(startMs + offset).toISOString()

  // Real time, scaled. A fixed frame step would make a four-hour route and a
  // forty-minute one play at completely different speeds.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const elapsed = now - last
      last = now
      setOffset((current) => {
        const next = current + elapsed * speed
        if (next >= span) {
          setPlaying(false)
          return span
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, span])

  const markers: RouteMarker[] = useMemo(
    () =>
      timeline
        .filter((e) => (e.kind === 'knock' || e.kind === 'appointment') && e.latitude !== undefined)
        .map((e) => ({
          id: `${e.kind}-${e.at}-${e.leadId ?? ''}`,
          latitude: e.latitude as number,
          longitude: e.longitude as number,
          colour:
            e.kind === 'appointment'
              ? '#059669'
              : (VERIFICATION_COLOUR[e.verification ?? 'gps_unavailable'] ?? '#64748b'),
          label: e.title,
          reached: Date.parse(e.at) <= startMs + offset,
        })),
    [timeline, offset, startMs],
  )

  const reachedCount = timeline.filter((e) => Date.parse(e.at) <= startMs + offset).length

  useEffect(() => {
    const list = listRef.current
    if (!list || !playing) return
    const active = list.querySelector('[data-active="true"]')
    if (active instanceof HTMLElement) {
      list.scrollTop = active.offsetTop - list.clientHeight / 2
    }
  }, [reachedCount, playing])

  return (
    <div className="space-y-3">
      <RouteMap
        points={points}
        markers={markers}
        through={cutoff}
        style={style}
        onStyleChange={setStyle}
        height={300}
      />

      <Card>
        <div className="flex items-center gap-3">
          <Button variant={playing ? 'secondary' : 'gold'} onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : offset >= span ? 'Replay' : 'Play route'}
          </Button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={span}
              step={1000}
              value={offset}
              onChange={(e) => {
                setPlaying(false)
                setOffset(Number(e.target.value))
              }}
              className="w-full accent-gold-400"
              aria-label="Route timeline"
            />
            <div className="mt-0.5 flex justify-between text-[10.5px] text-text-secondary">
              <span>{clock(session.startedAt)}</span>
              <span className="font-semibold text-text-secondary">{clock(cutoff)}</span>
              <span>{session.endedAt ? clock(session.endedAt) : 'now'}</span>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <span className="text-[10.5px] uppercase tracking-wide text-text-secondary">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                speed === s ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </Card>

      <div
        ref={listRef}
        className="max-h-80 overflow-y-auto rounded-2xl bg-bg-card p-1 ring-1 ring-border-subtle"
      >
        {timeline.map((entry, index) => {
          const reached = Date.parse(entry.at) <= startMs + offset
          const isLatest =
            reached && (index === timeline.length - 1 || Date.parse(timeline[index + 1]?.at ?? '') > startMs + offset)
          return (
            <TimelineRow key={`${entry.at}-${entry.kind}-${index}`} entry={entry} reached={reached} active={isLatest} />
          )
        })}
      </div>
    </div>
  )
}

function TimelineRow({
  entry,
  reached,
  active,
}: {
  entry: TimelineEntry
  reached: boolean
  active: boolean
}) {
  return (
    <div
      data-active={active}
      className={`flex gap-3 rounded-xl px-3 py-2 transition-opacity ${
        active ? 'bg-bg-elevated' : ''
      } ${reached ? 'opacity-100' : 'opacity-35'}`}
    >
      <span className="w-14 shrink-0 pt-0.5 text-[11px] tabular-nums text-text-secondary">
        {clock(entry.at)}
      </span>
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: KIND_COLOUR[entry.kind] ?? '#64748b' }}
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium">{entry.title}</p>
        {entry.detail && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-secondary">{entry.detail}</p>
        )}
      </div>
    </div>
  )
}
