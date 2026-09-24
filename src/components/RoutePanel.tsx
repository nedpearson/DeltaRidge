import { useCallback, useEffect, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useRouteTracking } from '@/features/routes/useRouteTracking'
import { pausedSeconds } from '@/features/routes/route-store'
import { routeStats, type DoorEvent } from '@/features/routes/route-stats'
import {
  buildFunnel,
  outcomeBreakdown,
  rateLabel,
  FUNNEL_LABEL,
} from '@/features/routes/recap'
import { eventsBetween } from '@/features/leads/lead-store'
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
  } | null>(null)
  const [counts, setCounts] = useState<LiveCounts>(EMPTY_COUNTS)

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
    })
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
        <Card>
          <p className="text-[13.5px] font-semibold">Route saved.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
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
            <p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/70">
              {stats.gapCount} stretch{stats.gapCount === 1 ? '' : 'es'} with no GPS, {duration(stats.gapSeconds)} in
              total. The doors you recorded in them are saved; the trail just has holes where the phone had
              no fix.
            </p>
          )}

          <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
            Distance counts only stretches the phone actually recorded. Gaps are left out rather than
            guessed at.
          </p>

          {/*
            Every outcome the rep recorded, in the order they read. Only the
            ones that happened - a screen of zeros in a driveway is noise.
          */}
          {outcomes.length > 0 && (
            <div className="mt-4 border-t border-white/8 pt-3">
              <p className="text-[11px] uppercase tracking-wider text-white/35">Doors worked</p>
              <ul className="mt-2 space-y-1">
                {outcomes.map((row) => (
                  <li key={row.outcome} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] text-white/75">{row.label}</span>
                    <span className="font-display text-[13px] text-white/90">{row.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            The funnel. Each rate is against the stage above it, and a stage
            with nothing above it shows a dash rather than 0% - see recap.ts.
          */}
          <div className="mt-4 border-t border-white/8 pt-3">
            <p className="text-[11px] uppercase tracking-wider text-white/35">How the day converted</p>
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
            {funnel.unmeasured.length > 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
                {funnel.unmeasured.map((k) => FUNNEL_LABEL[k].toLowerCase()).join(', ')} are not
                counted on this screen. They are left out rather than shown as zero, because a zero
                here would read as a bad day instead of a number nobody collected.
              </p>
            )}
          </div>

          <Button variant="gold" full className="mt-3" onClick={() => setSummary(null)}>
            Done
          </Button>
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
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            Starting a route records where you walk until you stop it, so a knock can be checked against
            where the phone actually was. Nothing is recorded before you start, after you stop, or while
            you are paused.
          </p>
          <Button variant="gold" full className="mt-3" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start route'}
          </Button>
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
            ? '!bg-amber-500/8 ring-amber-500/20'
            : '!bg-emerald-500/8 ring-emerald-500/20'
        }
      >
        <p className={`text-[13.5px] font-semibold ${paused ? 'text-amber-200' : 'text-emerald-200'}`}>
          {paused ? '⏸ Paused — nothing is being recorded.' : '● Recording your route.'}
        </p>
        <p className="mt-0.5 text-[11.5px] text-white/40">
          Started {new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
          {duration(elapsed)} elapsed{onBreak > 0 ? ` · ${duration(onBreak)} paused` : ''}
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat value={String(counts.doors)} label="doors" />
          <Stat value={String(counts.verified)} label="verified" />
          <Stat value={String(counts.conversations)} label="spoke to" />
          <Stat value={String(counts.appointments)} label="booked" />
          <Stat value={miles(routeStats(session, points).distanceMeters)} label="recorded" />
          <Stat value={counts.queued === 0 ? 'clear' : String(counts.queued)} label="waiting to send" />
        </div>

        {problem && <p className="mt-2 text-[12px] leading-relaxed text-amber-200/80">{problem}</p>}

        {confirmStop ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>
              Keep going
            </Button>
            <Button
              variant="gold"
              onClick={() => {
                setConfirmStop(false)
                void end()
              }}
            >
              End route
            </Button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void (paused ? resume() : pause())}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmStop(true)}>
              End route
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[16px] font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}
