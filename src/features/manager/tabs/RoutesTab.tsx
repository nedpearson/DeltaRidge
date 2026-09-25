import { useCallback, useEffect, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import RoutePlayback from '@/components/RoutePlayback'
import { Nothing, Stat, ago, duration, miles } from './shared'
import { readRoutePoints } from '../read'
import type { ActivityRow, RouteRow } from '../metrics'
import { routeStats, type DoorEvent } from '@/features/routes/route-stats'
import { integritySignals, needsReview } from '@/features/routes/integrity'
import type { RoutePoint, RouteSession } from '@/features/routes/route-store'
import type { TimelineActivity } from '@/features/routes/timeline'

/**
 * Every route worked, and any one of them replayed.
 *
 * The list is cheap — it comes from the summary view, which carries a count and
 * the last fix and nothing else. The trail is only fetched when a manager opens
 * one route, because handing out every GPS point of everybody's week to draw a
 * list would be a surveillance feature wearing a dashboard's clothes.
 */

export default function RoutesTab({
  routes,
  activity,
  orgId,
  nameOf,
  loading,
}: {
  routes: readonly RouteRow[]
  activity: readonly ActivityRow[]
  orgId: string | null
  nameOf: (id: string | null) => string
  loading: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (routes.length === 0) {
    return loading ? (
      <Card>
        <p className="text-[12.5px] text-slate-600">Reading routes…</p>
      </Card>
    ) : (
      <Nothing
        title="No routes in this window"
        body="A route appears here once a rep has started and ended one. Nothing is recorded outside a route they started themselves."
      />
    )
  }

  if (openId) {
    const route = routes.find((r) => r.id === openId)
    if (route) {
      return <OneRoute route={route} activity={activity} orgId={orgId} nameOf={nameOf} onBack={() => setOpenId(null)} />
    }
  }

  return (
    <div className="space-y-2">
      <SectionTitle hint={`${routes.length} route${routes.length === 1 ? '' : 's'}`}>ROUTE HISTORY</SectionTitle>
      {routes.map((route) => (
        <Card key={route.id}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[14px] font-semibold">{nameOf(route.userId)}</p>
            <span className="shrink-0 text-[11px] text-slate-600">
              {new Date(route.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-slate-600">
            {new Date(route.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            {route.endedAt
              ? ` – ${new Date(route.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${duration(
                  (Date.parse(route.endedAt) - Date.parse(route.startedAt)) / 1000,
                )}`
              : ' · still open'}
            {route.label ? ` · ${route.label}` : ''}
          </p>
          <p className="mt-1 text-[11.5px] text-slate-600">
            {route.pointCount} fix{route.pointCount === 1 ? '' : 'es'}
            {route.pointCount === 0 ? ' — no trail was recorded for this one' : ''}
          </p>
          <Button variant="secondary" full className="mt-2.5" onClick={() => setOpenId(route.id)}>
            View route
          </Button>
        </Card>
      ))}
    </div>
  )
}

function OneRoute({
  route,
  activity,
  orgId,
  nameOf,
  onBack,
}: {
  route: RouteRow
  activity: readonly ActivityRow[]
  orgId: string | null
  nameOf: (id: string | null) => string
  onBack: () => void
}) {
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await readRoutePoints(orgId, route.id)
    setPoints(result.points)
    setError(result.error)
    setLoading(false)
  }, [orgId, route.id])

  useEffect(() => {
    void load()
  }, [load])

  const from = route.startedAt
  const to = route.endedAt ?? new Date().toISOString()
  // Activities are matched to the route by time and rep, which is the only
  // link that exists: a knock records who and when, not which route it was in.
  // Said on the screen rather than hidden, because a knock recorded a minute
  // after a rep ended their route will sit outside this list.
  const mine = activity.filter(
    (a) => a.userId === route.userId && a.occurredAt >= from && a.occurredAt <= to,
  )

  const session: RouteSession = {
    id: route.id,
    startedAt: route.startedAt,
    ...(route.endedAt ? { endedAt: route.endedAt } : {}),
    ...(route.label ? { label: route.label } : {}),
    // Carried through so a declared break shows on the manager's timeline as
    // the same break the rep took. Without it the route reads as continuous
    // work, which is the opposite of what pausing was for.
    ...(route.pauses.length > 0 ? { pauses: route.pauses } : {}),
    deviceId: '',
  }

  const events: DoorEvent[] = mine.map((a) => ({
    leadId: a.leadClientId,
    at: a.occurredAt,
    activityType: a.activityType,
    outcome: a.outcome,
    gpsVerification: a.gpsVerification,
  }))

  const timelineActivities: TimelineActivity[] = mine.map((a) => ({
    leadId: a.leadClientId,
    at: a.occurredAt,
    activityType: a.activityType,
    outcome: a.outcome,
    gpsVerification: a.gpsVerification,
    address: a.address,
  }))

  const stats = routeStats(session, points, events)
  const signals = integritySignals(points, events, {
    routeOpen: !route.endedAt,
    routeSeconds: stats.routeSeconds,
  })

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-[12.5px] font-medium text-slate-600">
        ← All routes
      </button>

      <Card>
        <p className="text-[14px] font-semibold">{nameOf(route.userId)}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-600">
          {new Date(route.startedAt).toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          {route.endedAt ? '' : ' · still open'}
        </p>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat value={duration(stats.routeSeconds)} label="start to stop" />
          <Stat value={miles(stats.distanceMeters)} label="recorded" />
          <Stat value={String(stats.doors.doors)} label="doors" />
          <Stat value={String(stats.doors.verified)} label="verified" />
          <Stat value={String(stats.doors.conversations)} label="conversations" />
          <Stat value={String(stats.doors.appointments)} label="booked" />
        </div>

        <div className="mt-3 space-y-1 border-t border-slate-300 pt-2 text-[11.5px] leading-relaxed text-slate-600">
          <p>
            Tracked {duration(stats.trackedSeconds)} from first fix to last. Paused{' '}
            {duration(stats.pausedSeconds)}. {stats.gapCount} gap{stats.gapCount === 1 ? '' : 's'} totalling{' '}
            {duration(stats.gapSeconds)}.
          </p>
          <p>
            These four do not add up to each other and are not made to. Start-to-stop, time with a fix, time
            the rep declared a break, and time with no record are four different measurements of the same
            afternoon.
          </p>
          {stats.worstAccuracyMeters !== null && (
            <p>
              The worst fix in this route was accurate to ±{Math.round(stats.worstAccuracyMeters)} m. Nothing
              above is more precise than that allows.
            </p>
          )}
        </div>
      </Card>

      {signals.length > 0 && (
        <Card className={needsReview(signals) ? '!bg-amber-100 ring-amber-300' : ''}>
          <p className="text-[13px] font-semibold">
            {needsReview(signals) ? 'Worth opening before you draw a conclusion' : 'Worth knowing'}
          </p>
          <div className="mt-2 space-y-2.5">
            {signals.map((signal) => (
              <div key={signal.code}>
                <p className="text-[12.5px] font-medium">{signal.observed}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">
                  Usually: {signal.ordinary}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600">{signal.check}</p>
              </div>
            ))}
          </div>
          <p className="mt-2.5 border-t border-slate-300 pt-2 text-[11px] leading-relaxed text-slate-600">
            None of this is a finding about the rep. These are shapes in the data with an ordinary
            explanation attached to each one.
          </p>
        </Card>
      )}

      {error && (
        <Card className="!bg-amber-100 ring-amber-300">
          <p className="text-[12.5px] text-amber-100/80">The trail could not be read: {error}</p>
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-[12.5px] text-slate-600">Reading the trail…</p>
        </Card>
      ) : (
        <RoutePlayback session={session} points={points} activities={timelineActivities} />
      )}

      <p className="text-[10.5px] leading-relaxed text-slate-600">
        Doors are matched to this route by rep and time — the only link that exists, since a knock records
        who and when rather than which route it belonged to. Anything recorded after the route ended will
        not appear here. Last fix {ago(route.lastFixAt)}.
      </p>
    </div>
  )
}
