import { useCallback, useEffect, useMemo, useState } from 'react'
import RoutePlayback from '@/components/RoutePlayback'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { byAddress, eventsBetween, readLeads } from '@/features/leads/lead-store'
import type { ContactEvent, ManagedLead } from '@/features/leads/pipeline'
import {
  eventsForSession,
  HISTORY_WINDOWS,
  resolveHistoryWindow,
  sessionsInWindow,
  summariseSession,
  type Attribution,
  type HistoryWindowKey,
  type RouteDaySummary,
} from '@/features/routes/history'
import { listPoints, listSessions, type RoutePoint, type RouteSession } from '@/features/routes/route-store'
import { buildFunnel, outcomeBreakdown, rateLabel } from '@/features/routes/recap'
import type { TimelineActivity } from '@/features/routes/timeline'

/**
 * Every route the rep has run, on this device.
 *
 * Local only, and that is stated on the screen rather than left to be
 * discovered. Route sessions are pushed to the office but never pulled back
 * down, so a reinstalled phone has no history to show - claiming otherwise, or
 * showing an empty list with no explanation, would both read as data loss.
 */

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function miles(metres: number): string {
  return `${(metres / 1609.344).toFixed(1)} mi`
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/**
 * Said out loud, because the two are not equally trustworthy and a rep
 * comparing two days deserves to know which one is a record and which is a
 * reconstruction.
 */
const ATTRIBUTION_NOTE: Record<Attribution, string | null> = {
  stamped: null,
  inferred:
    'This route predates door-to-route recording, so its doors are matched by time of day. ' +
    'Anything recorded while out of signal may be missing or belong to another route.',
  none: null,
}

export default function RouteHistoryPage() {
  const [windowKey, setWindowKey] = useState<HistoryWindowKey>('this_week')
  const [sessions, setSessions] = useState<RouteSession[]>([])
  const [events, setEvents] = useState<ContactEvent[]>([])
  const [leads, setLeads] = useState<ManagedLead[]>([])
  const [pointsBySession, setPointsBySession] = useState<Record<string, RoutePoint[]>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [mode, setMode] = useState<'replay' | 'activity'>('replay')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, l] = await Promise.all([listSessions(120), readLeads()])
      // Everything, not a window: a stamped activity can sit outside its own
      // route's start and stop, which is the entire point of the stamp.
      const e = await eventsBetween(new Date(0).toISOString(), new Date().toISOString())
      if (cancelled) return
      setSessions(s)
      setLeads(l)
      setEvents(e)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const window = useMemo(() => resolveHistoryWindow(windowKey), [windowKey])
  const inWindow = useMemo(() => sessionsInWindow(sessions, window), [sessions, window])

  const loadPoints = useCallback(
    async (id: string) => {
      if (pointsBySession[id]) return
      const points = await listPoints(id)
      setPointsBySession((prev) => ({ ...prev, [id]: points }))
    },
    [pointsBySession],
  )

  const summaries: RouteDaySummary[] = useMemo(
    () => inWindow.map((s) => summariseSession(s, pointsBySession[s.id] ?? [], events)),
    [inWindow, pointsBySession, events],
  )

  // Points are needed for distance, so load them for everything on screen.
  useEffect(() => {
    for (const s of inWindow) void loadPoints(s.id)
  }, [inWindow, loadPoints])

  const open = inWindow.find((s) => s.id === openId) ?? null
  const openSummary = summaries.find((s) => s.sessionId === openId) ?? null

  if (open && openSummary) {
    const points = pointsBySession[open.id] ?? []
    const leadById = byAddress(leads)
    const addressOf = (leadId: string): string => {
      for (const lead of leadById.values()) if (lead.id === leadId) return lead.address
      return 'Unknown address'
    }

    const { events: door } = eventsForSession(open, events)
    const activities: TimelineActivity[] = door.map((e) => ({
      leadId: e.leadId,
      at: e.at,
      activityType: e.activityType,
      outcome: e.outcome,
      gpsVerification: e.gpsVerification,
      address: addressOf(e.leadId),
    }))

    const outcomes = outcomeBreakdown(door, { nonZero: true })
    const funnel = buildFunnel(door)
    const note = ATTRIBUTION_NOTE[openSummary.attribution]
    const hasTrail = points.length > 0

    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle>{day(open.startedAt).toUpperCase()}</SectionTitle>
          <button
            className="text-[12px] text-white/50 underline underline-offset-2"
            onClick={() => setOpenId(null)}
          >
            Back
          </button>
        </div>

        <Card className="mb-3">
          <p className="text-[13.5px] font-semibold">
            {clock(open.startedAt)}
            {open.endedAt ? ` → ${clock(open.endedAt)}` : ' — still running'}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat value={miles(openSummary.stats.distanceMeters)} label="recorded" />
            <Stat value={duration(openSummary.stats.routeSeconds)} label="start to stop" />
            <Stat value={String(openSummary.stats.doors.doors)} label="doors" />
          </div>
          {/*
            Said on the card rather than only inside the Replay tab, because
            "0.0 mi recorded" on its own reads as a rep who did not move. It is
            the difference between no distance and no measurement.
          */}
          {!hasTrail && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-white/45">
              No GPS was recorded on this route, so there is no distance to report — 0.0 mi means
              nothing was measured, not that nobody moved.
            </p>
          )}
          {note && <p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/70">{note}</p>}
        </Card>

        {/*
          Replay is offered only when there is something to replay. Every route
          recorded so far has no trail - they were run in a desktop browser with
          no geolocation - so defaulting to Replay meant opening a route showed
          an empty box and nothing else. The tab that HAS content is the one to
          land on, and a button that can only lead somewhere empty should not
          look like a live choice.
        */}
        <div className="mb-3 flex gap-2">
          <Button
            variant={mode === 'replay' ? 'gold' : 'secondary'}
            disabled={!hasTrail}
            onClick={() => setMode('replay')}
          >
            {hasTrail ? 'Replay' : 'Replay · no trail'}
          </Button>
          <Button
            variant={mode === 'activity' ? 'gold' : 'secondary'}
            onClick={() => setMode('activity')}
          >
            Activity
          </Button>
        </div>

        {mode === 'replay' && hasTrail ? (
          <RoutePlayback session={open} points={points} activities={activities} />
        ) : (
          <>
            {outcomes.length > 0 && (
              <Card className="mb-3">
                <p className="text-[11px] uppercase tracking-wider text-white/35">Doors worked</p>
                <ul className="mt-2 space-y-1">
                  {outcomes.map((row) => (
                    <li key={row.outcome} className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] text-white/75">{row.label}</span>
                      <span className="font-display text-[13px] text-white/90">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <p className="text-[11px] uppercase tracking-wider text-white/35">
                How the day converted
              </p>
              <ul className="mt-2 space-y-1">
                {funnel.stages.map((stage) => (
                  <li key={stage.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-white/75">{stage.label}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-display text-[13px] text-white/90">{stage.count}</span>
                      <span className="w-10 text-right text-[11px] text-white/35">
                        {rateLabel(stage.rate)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <SectionTitle>ROUTE HISTORY</SectionTitle>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {HISTORY_WINDOWS.map((w) => (
          <button
            key={w.key}
            onClick={() => setWindowKey(w.key)}
            className={
              'rounded-full px-3 py-1.5 text-[11.5px] ' +
              (w.key === windowKey ? 'bg-gold-400/20 text-gold-200' : 'bg-white/6 text-white/55')
            }
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-10 text-center text-[13px] text-white/40">Loading…</p>
      ) : summaries.length === 0 ? (
        <Empty
          title={`No routes ${window.label.toLowerCase()}`}
          body="History is kept on this phone, so a route run on another device will not be here."
        />
      ) : (
        <ul className="space-y-2">
          {summaries.map((s) => (
            <li key={s.sessionId}>
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13.5px] font-semibold">{day(s.startedAt)}</p>
                  <p className="text-[12px] text-white/45">
                    {clock(s.startedAt)}
                    {s.endedAt ? ` → ${clock(s.endedAt)}` : ' — running'}
                  </p>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                  <Stat value={miles(s.stats.distanceMeters)} label="miles" />
                  <Stat value={String(s.stats.doors.doors)} label="doors" />
                  <Stat value={String(s.stats.doors.conversations)} label="spoke to" />
                  <Stat value={String(s.stats.doors.appointments)} label="booked" />
                </div>

                {s.attribution === 'inferred' && (
                  <p className="mt-2 text-[11px] text-amber-200/60">Doors matched by time of day</p>
                )}
                {(pointsBySession[s.sessionId]?.length ?? 0) === 0 && (
                  <p className="mt-1 text-[11px] text-white/35">No GPS recorded — nothing to replay</p>
                )}

                <Button
                  variant="secondary"
                  full
                  className="mt-3"
                  onClick={() => {
                    setOpenId(s.sessionId)
                    // Land on the tab that has something in it.
                    setMode((pointsBySession[s.sessionId]?.length ?? 0) > 0 ? 'replay' : 'activity')
                  }}
                >
                  View route
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[15px] font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}
