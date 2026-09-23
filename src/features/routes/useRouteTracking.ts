import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listPoints,
  openSession,
  recordPoint,
  startSession,
  stopSession,
  type RoutePoint,
  type RouteSession,
} from './route-store'
import { shouldKeepPoint } from './tracking'

/**
 * Location recording that exists only while a rep has said it should.
 *
 * The watch is started by `start()` and cleared by `stop()`, by unmount, and by
 * any path that ends the session. There is no branch that begins watching on
 * its own — not on mount, not on sign-in, not on opening the app. A rep who has
 * not pressed start is not being recorded, and that is enforced here and again
 * in `recordPoint`, which refuses without an open session.
 *
 * `watchPosition` rather than a polling timer: the browser decides when the
 * radio is worth waking, which is better for the battery than a fixed interval
 * and is the only option that keeps working when the screen dims.
 */

export interface RouteTracking {
  session: RouteSession | null
  points: RoutePoint[]
  /** What the browser said about permission, in words the rep can act on. */
  problem: string | null
  start: (label?: string) => Promise<void>
  stop: () => Promise<void>
  starting: boolean
}

export function useRouteTracking(): RouteTracking {
  const [session, setSession] = useState<RouteSession | null>(null)
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const watchId = useRef<number | null>(null)
  const lastKept = useRef<RoutePoint | null>(null)

  const clearWatch = useCallback(() => {
    if (watchId.current !== null && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchId.current)
    }
    watchId.current = null
  }, [])

  const refreshPoints = useCallback(async (id: string) => {
    const rows = await listPoints(id)
    setPoints(rows)
    lastKept.current = rows[rows.length - 1] ?? null
  }, [])

  const watch = useCallback(
    (id: string) => {
      if (!('geolocation' in navigator)) {
        setProblem('This device has no location services, so the route will have no map.')
        return
      }
      clearWatch()
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          setProblem(null)
          const candidate = {
            recordedAt: new Date(pos.timestamp).toISOString(),
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          }
          const decision = shouldKeepPoint(candidate, lastKept.current)
          if (!decision.keep) return
          void recordPoint(id, {
            recordedAt: candidate.recordedAt,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            ...(Number.isFinite(pos.coords.accuracy) ? { accuracyMeters: pos.coords.accuracy } : {}),
            ...(pos.coords.altitude !== null ? { altitudeMeters: pos.coords.altitude } : {}),
            ...(pos.coords.speed !== null ? { speedMps: pos.coords.speed } : {}),
            ...(pos.coords.heading !== null ? { headingDeg: pos.coords.heading } : {}),
          }).then((saved) => {
            if (!saved) return
            lastKept.current = saved
            setPoints((prev) => [...prev, saved])
          })
        },
        (err) => {
          // Named, because "location unavailable" tells a rep nothing about
          // whether their knocks are still being recorded. They are.
          setProblem(
            err.code === err.PERMISSION_DENIED
              ? 'Location is switched off for this site, so the route will have no map. Your knocks are still being saved.'
              : 'No location fix right now. Your knocks are still being saved.',
          )
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
      )
    },
    [clearWatch],
  )

  // Picks a session back up after a reload or a crash. It does NOT start one.
  useEffect(() => {
    let cancelled = false
    void openSession().then(async (found) => {
      if (cancelled || !found) return
      setSession(found)
      await refreshPoints(found.id)
      watch(found.id)
    })
    return () => {
      cancelled = true
      clearWatch()
    }
  }, [refreshPoints, watch, clearWatch])

  const start = useCallback(
    async (label?: string) => {
      setStarting(true)
      try {
        const created = await startSession(new Date().toISOString(), label)
        setSession(created)
        setPoints([])
        lastKept.current = null
        watch(created.id)
      } finally {
        setStarting(false)
      }
    },
    [watch],
  )

  const stop = useCallback(async () => {
    clearWatch()
    if (!session) return
    const closed = await stopSession(session.id, new Date().toISOString())
    setSession(closed && !closed.endedAt ? closed : null)
    lastKept.current = null
  }, [session, clearWatch])

  return { session, points, problem, start, stop, starting }
}
