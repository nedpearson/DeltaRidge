import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useRouteTracking } from '@/features/routes/useRouteTracking'
import { pausedSeconds, type RoutePoint } from '@/features/routes/route-store'
import { routeStats, type DoorEvent } from '@/features/routes/route-stats'
import RouteMap from './RouteMap'
import {
  buildFunnel,
  outcomeBreakdown,
  rateLabel,
  FUNNEL_LABEL,
} from '@/features/routes/recap'
import {
  groupOpenItems,
  openItems as buildOpenItems,
  type OpenItem,
} from '@/features/routes/open-items'
import { eventsBetween, readLeads } from '@/features/leads/lead-store'
import { listInspections } from '@/lib/db'
import { unsyncedPointCount } from '@/lib/sync/routes'

/**
 * Start, run and end a work route, and say plainly what that means.
 *
 * The copy is part of the feature. A rep who does not know when their phone is
 * recording their location will either not use this or will resent it, and both
 * are worse outcomes than not building it. So: nothing starts on its own, the
 * card says what is happening while it is happening, pausing genuinely stops
 * the recording rather than hiding it, and stopping is one tap from anywhere
 * this panel is visible.
 *
 * The numbers on the card are the rep's own work read back to them. That is
 * deliberate too — the same figures reach a manager, and a rep who can see them
 * all day is a rep who can argue with them the same day rather than in a review
 * three weeks later.
 */

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function miles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`
}

interface LiveCounts {
  doors: number
  knocks: number
  verified: number
  conversations: number
  appointments: number
  queued: number
}

const EMPTY_COUNTS: LiveCounts = {
  doors: 0,
  knocks: 0,
  verified: 0,
  conversations: 0,
  appointments: 0,
  queued: 0,
}

export default function RoutePanel() {
  const { session, points, problem, start, stop, pause, resume, paused, starting } = useRouteTracking()
  const [confirmStop, setConfirmStop] = useState(false)
  const [summary, setSummary] = useState<{
    stats: ReturnType<typeof routeStats>
    counts: LiveCounts
    // Kept so the recap can break the day down by outcome and build the
    // funnel from the same events the totals came from, rather than from a
    // second read that could disagree with them.
    events: DoorEvent[]
    open: OpenItem[]
    points: RoutePoint[]
  } | null>(null)
  const [counts, setCounts] = useState<LiveCounts>(EMPTY_COUNTS)
  /**
   * What is still open, read when the rep reaches for End route.
   *
   * Null means not looked at yet, which is what the button press changes. It is
   * shown to inform the decision and never to block it - see the buttons below.
   */
  const [pendingOpen, setPendingOpen] = useState<OpenItem[] | null>(null)

  const readCounts = useCallback(async (): Promise<{ counts: LiveCounts; events: DoorEvent[] }> => {
    if (!session) return { counts: EMPTY_COUNTS, events: [] }
    const raw = await eventsBetween(session.startedAt, session.endedAt ?? new Date().toISOString())
    const events: DoorEvent[] = raw.map((e) => ({
      leadId: e.leadId,
      at: e.at,
      activityType: e.kind === 'appointment_set' ? 'appointment' : e.kind,
      outcome: e.outcome ?? null,
      gpsVerification: e.gps?.verification ?? null,
    }))
    const stats = routeStats(session, points, events)
    return {
      counts: {
        doors: stats.doors.doors,
        knocks: stats.doors.knocks,
        verified: stats.doors.verified,
        conversations: stats.doors.conversations,
        appointments: stats.doors.appointments,
        queued: await unsyncedPointCount(session.id),
      },
      events,
    }
  }, [session, points])

  useEffect(() => {
    if (!session) {
      setCounts(EMPTY_COUNTS)
      return
    }
    let cancelled = false
    const refresh = () => void readCounts().then((r) => !cancelled && setCounts(r.counts))
    refresh()
    const timer = setInterval(refresh, 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [session, readCounts])

  /**
   * Reads what is still open against the doors this route touched.
   *
   * Never throws. If leads or inspections cannot be read, the rep gets an empty
   * list and ends their route - a failed read must not become a screen that
   * stands between somebody and going home.
   */
  const readOpen = useCallback(
    async (events: readonly DoorEvent[], at: string): Promise<OpenItem[]> => {
      try {
        const [leads, inspections] = await Promise.all([readLeads(), listInspections()])
        return buildOpenItems({
          leads,
          events,
          inspections: inspections.map((i) => ({ id: i.id, status: i.status })),
          now: at,
        })
      } catch {
        return []
      }
    },
    [],
  )

  const askToStop = async () => {
    setConfirmStop(true)
    if (!session) return
    const { events } = await readCounts()
    setPendingOpen(await readOpen(events, new Date().toISOString()))
  }

  const end = async () => {
    if (!session) return
    const { counts: finalCounts, events } = await readCounts()
    const at = new Date().toISOString()
    // The summary is built from the session as it was a moment before it
    // closed, plus the closing instant, so the figures the rep signs off on are
    // the figures that were stored.
    setSummary({
      stats: routeStats({ ...session, endedAt: at }, points, events),
      counts: finalCounts,
      events,
      points,
      // Read again at the closing instant rather than reusing what the confirm
      // screen showed: the rep may have gone and fixed something, and the
      // report should say what is true now, not what was true a minute ago.
      open: pendingOpen !== null ? await readOpen(events, at) : [],
    })
    setPendingOpen(null)
    await stop()
  }

  if (summary) {
    const { stats, counts: final } = summary
    const outcomes = outcomeBreakdown(summary.events, { nonZero: true })
    // No estimate, proposal or sale source is available on the phone at route
    // end, so those stages are omitted rather than reported as zero.
    const funnel = buildFunnel(summary.events)
    return (
      <>
        <SectionTitle>ROUTE SUMMARY</SectionTitle>
        <Card className="!p-0 overflow-hidden">
          {summary.points.length > 0 && (
            <div className="h-48 w-full border-b border-border-subtle bg-background-app">
              <RouteMap points={summary.points} height={192} />
            </div>
          )}
          <div className="p-4">
            <p className="text-[13.5px] font-semibold">Route saved.</p>
            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
              Everything below is on this phone already. It reaches the office as soon as there is signal —
              you do not have to wait here for it.
            </p>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat value={duration(stats.routeSeconds)} label="start to stop" />
            <Stat value={duration(stats.pausedSeconds)} label="paused" />
            <Stat value={miles(stats.distanceMeters)} label="recorded" />
            <Stat value={String(final.doors)} label="doors" />
            <Stat value={String(final.verified)} label="GPS verified" />
            <Stat value={String(final.conversations)} label="conversations" />
          </div>

          {stats.gapCount > 0 && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-status-warning/70">
              {stats.gapCount} stretch{stats.gapCount === 1 ? '' : 'es'} with no GPS, {duration(stats.gapSeconds)} in
              total. The doors you recorded in them are saved; the trail just has holes where the phone had
              no fix.
            </p>
          )}

          <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">
            Distance counts only stretches the phone actually recorded. Gaps are left out rather than
            guessed at.
          </p>

          {/*
            Every outcome the rep recorded, in the order they read. Only the
            ones that happened - a screen of zeros in a driveway is noise.
          */}
          {outcomes.length > 0 && (
            <div className="mt-4 border-t border-border-subtle pt-3">
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Doors worked</p>
              <ul className="mt-2 space-y-1">
                {outcomes.map((row) => (
                  <li key={row.outcome} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-text-secondary">{row.label}</span>
                    <span className="font-display text-[13px] text-text-secondary">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            The funnel. Each rate is against the stage above it, and a stage
            with nothing above it shows a dash rather than 0% - see recap.ts.
          */}
          <div className="mt-4 border-t border-border-subtle pt-3">
            <p className="text-[11px] uppercase tracking-wider text-text-secondary">How the day converted</p>
            <ul className="mt-2 space-y-1">
              {funnel.stages.map((stage) => (
                <li key={stage.key} className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] text-text-secondary">{stage.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-display text-[13px] text-text-secondary">{stage.count}</span>
                    <span className="w-10 text-right text-[11px] text-text-secondary">
                      {rateLabel(stage.rate)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {funnel.unmeasured.length > 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">
                {funnel.unmeasured.map((k) => FUNNEL_LABEL[k].toLowerCase()).join(', ')} are not
                counted on this screen. They are left out rather than shown as zero, because a zero
                here would read as a bad day instead of a number nobody collected.
              </p>
            )}
          </div>

          {/*
            The part of this screen actually worth reading. Everything above
            says what happened; this says what will not happen unless somebody
            does it. Named records only - never a judgement about the rep.
          */}
          {summary.open.length > 0 && (
            <div className="mt-4 border-t border-border-subtle pt-3">
              <p className="text-[11px] uppercase tracking-wider text-status-warning/60">
                Still open · {summary.open.length}
              </p>
              <ul className="mt-2 space-y-2">
                {groupOpenItems(summary.open).map((group) => (
                  <li key={group.kind}>
                    <p className="text-[11.5px] text-text-secondary">{group.label}</p>
                    {group.items.map((item) => (
                      <p key={item.leadId} className="truncate text-[12.5px] text-text-secondary">
                        {item.address}
                        <span className="text-text-secondary"> — {item.detail}</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

            <Button variant="gold" full className="mt-4" onClick={() => setSummary(null)}>
              Done
            </Button>
          </div>
        </Card>
      </>
    )
  }

  if (!session) {
    return (
      <>
        <SectionTitle>FIELD ROUTE</SectionTitle>
        <Card>
          <p className="text-[13.5px]">Not started.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
            Starting a route records where you walk until you stop it, so a knock can be checked against
            where the phone actually was. Nothing is recorded before you start, after you stop, or while
            you are paused.
          </p>
          <Button variant="gold" full className="mt-3" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start route'}
          </Button>
          {/* The only way into history. A route nobody can reopen was not worth recording. */}
          <Link
            to="/routes"
            className="mt-3 block text-center text-[12px] text-text-secondary underline underline-offset-2"
          >
            Past routes
          </Link>
        </Card>
      </>
    )
  }

  const elapsed = (Date.now() - Date.parse(session.startedAt)) / 1000
  const onBreak = pausedSeconds(session)

  return (
    <>
      <SectionTitle hint={paused ? 'paused' : 'recording'}>FIELD ROUTE</SectionTitle>
      <Card
        className={
          paused
            ? 'bg-bg-elevated ring-1 ring-border-strong'
            : 'bg-route-surface ring-1 ring-route-border shadow-[0_0_28px_rgba(39,198,232,0.10)]'
        }
      >
        <div className={`flex items-center gap-2 text-[13.5px] font-semibold tracking-wide ${paused ? 'text-status-warning' : 'text-route-live'}`}>
          {!paused && <span className="h-2 w-2 rounded-full bg-route-live animate-pulse"></span>}
          {paused ? 'PAUSED - NOT RECORDING' : 'RECORDING'}
        </div>
        <p className={`mt-1.5 text-[11.5px] ${paused ? 'text-text-secondary' : 'text-route-text-secondary'}`}>
          Started {new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
          {duration(elapsed)} elapsed{onBreak > 0 ? ` · ${duration(onBreak)} paused` : ''}
        </p>

        <div className={`mt-3 grid grid-cols-3 gap-2 text-center ${paused ? 'text-text-primary' : 'text-route-text'}`}>
          <Stat value={String(counts.doors)} label="doors" paused={paused} />
          <Stat value={String(counts.verified)} label="verified" paused={paused} />
          <Stat value={String(counts.conversations)} label="spoke to" paused={paused} />
          <Stat value={String(counts.appointments)} label="booked" paused={paused} />
          <Stat value={miles(routeStats(session, points).distanceMeters)} label="recorded" paused={paused} />
          <Stat value={counts.queued === 0 ? 'clear' : String(counts.queued)} label="waiting to send" paused={paused} />
        </div>

        {problem && <p className="mt-2 text-[12px] leading-relaxed text-status-warning/80">{problem}</p>}

        {confirmStop ? (
          <div className="mt-4 border-t border-border-subtle pt-3">
            {/*
              Shown to inform the decision, never to gate it. The End route
              button below is always enabled - a rep standing in the rain at
              5pm gets to go home, and software that argues with them about it
              teaches them to stop starting routes at all.
            */}
            {pendingOpen !== null && pendingOpen.length > 0 && (
              <div className="mb-3 rounded-lg border border-warning-border bg-warning-surface p-3">
                <p className="text-[12.5px] font-semibold text-warning-highlight">
                  {pendingOpen.length} still open
                </p>
                <ul className="mt-2 space-y-1.5">
                  {groupOpenItems(pendingOpen).map((group) => (
                    <li key={group.kind}>
                      <p className="text-[11px] uppercase tracking-wider text-warning-highlight/60">
                        {group.label} · {group.items.length}
                      </p>
                      {group.items.slice(0, 3).map((item) => (
                        <p key={item.leadId} className="truncate text-[12px] text-text-secondary">
                          {item.address}
                        </p>
                      ))}
                      {group.items.length > 3 && (
                        <p className="text-[11.5px] text-text-secondary">
                          and {group.items.length - 3} more
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">
                  These are on the summary after you end, and they stay on the doors. Ending the
                  route does not lose them.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmStop(false)
                setPendingOpen(null)
              }}
            >
              Keep going
            </Button>
            <Button
              className="bg-bg-card ring-1 ring-status-critical/50 text-status-critical hover:bg-status-critical/10"
              onClick={() => {
                setConfirmStop(false)
                void end()
              }}
            >
              Confirm End
            </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void (paused ? resume() : pause())}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              className="bg-bg-card ring-1 ring-border-strong text-status-critical/90 hover:bg-status-critical/10 hover:ring-status-critical/50"
              onClick={() => void askToStop()}
            >
              End route
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}

function Stat({ value, label, paused }: { value: string; label: string; paused?: boolean }) {
  return (
    <div>
      <p className="text-[16px] font-semibold tabular-nums">{value}</p>
      <p className={`text-[10px] uppercase tracking-wide ${paused ? 'text-text-secondary' : 'text-route-text-secondary'}`}>{label}</p>
    </div>
  )
}
