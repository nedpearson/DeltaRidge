import { openDB, type IDBPDatabase } from 'idb'
import { newId, queueSync } from '@/lib/db'
import { deviceId } from '@/lib/device'

/**
 * A rep's own record of when they were working and where they walked.
 *
 * Captured through the SAME outbox as knocks, notes, photos and lead statuses,
 * deliberately and without a shortcut. Route data looks like telemetry, and
 * telemetry is the kind of thing that gets its own "simpler" uploader which
 * drops points when the network is bad — which is precisely the offline-sync
 * problem the lead layer just spent a week fixing. One queue, one retry
 * schedule, one place to look when something has not arrived.
 *
 * The privacy shape is in the data model, not in a policy document:
 *
 *   - A point cannot exist without a session, and a session cannot exist
 *     without the rep having pressed start.
 *   - `stopSession` is the only thing that closes one. Nothing closes it on the
 *     rep's behalf, and nothing reopens it.
 *   - Nothing here is recorded between sessions. There is no code path that
 *     could, because `recordPoint` refuses without an open session.
 */

const DB_NAME = 'delta-ridge-routes'
const SESSIONS = 'sessions'
const POINTS = 'points'

/**
 * A stretch the rep took themselves off the clock for.
 *
 * `until` absent means it is still running. Nothing is recorded while one is
 * open — `recordPoint` refuses — which is what makes pause meaningful rather
 * than cosmetic. A rep who pauses for lunch and finds their phone logged the
 * restaurant will pause once and never again.
 */
export interface RoutePause {
  at: string
  until?: string
}

export interface RouteSession {
  id: string
  startedAt: string
  endedAt?: string
  /** What the rep called it, if anything. */
  label?: string
  /** Why it ended: the rep stopped it, or the app found it left open. */
  endedReason?: 'stopped' | 'abandoned'
  deviceId: string
  /** Breaks taken during the route, oldest first. */
  pauses?: RoutePause[]
}

export interface RoutePoint {
  id: string
  sessionId: string
  recordedAt: string
  latitude: number
  longitude: number
  /**
   * The device's own accuracy estimate, carried through untouched. Every claim
   * made from this point is bounded by it.
   */
  accuracyMeters?: number
  altitudeMeters?: number
  speedMps?: number
  headingDeg?: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SESSIONS)) {
          const sessions = db.createObjectStore(SESSIONS, { keyPath: 'id' })
          sessions.createIndex('by-started', 'startedAt')
        }
        if (!db.objectStoreNames.contains(POINTS)) {
          const points = db.createObjectStore(POINTS, { keyPath: 'id' })
          points.createIndex('by-session', 'sessionId')
        }
      },
    })
  }
  return dbPromise
}

/** Queueing is best-effort: a failed enqueue must not lose the rep's record. */
async function queue(entity: 'routeSession' | 'routePoint', id: string): Promise<void> {
  try {
    await queueSync(entity, id)
  } catch {
    // The session is re-queued when it is stopped, and the sync screen counts
    // what is actually waiting rather than what was meant to be.
  }
}

export async function startSession(at: string, label?: string): Promise<RouteSession> {
  const session: RouteSession = {
    id: newId(),
    startedAt: at,
    deviceId: deviceId(),
    ...(label !== undefined && label !== '' ? { label } : {}),
  }
  const db = await getDb()
  await db.put(SESSIONS, session)
  await queue('routeSession', session.id)
  return session
}

/** The pause still running, if there is one. */
export function openPause(session: RouteSession): RoutePause | null {
  const last = session.pauses?.[session.pauses.length - 1]
  return last && !last.until ? last : null
}

export function isPaused(session: RouteSession): boolean {
  return !session.endedAt && openPause(session) !== null
}

/**
 * Seconds the rep was deliberately off the clock.
 *
 * An open pause is measured up to `now`, so the number a rep sees while paused
 * keeps moving rather than jumping when they resume. Nothing here infers a
 * break from the GPS: a gap in the trail is a gap in the evidence, and calling
 * it a break would be the app deciding what somebody was doing.
 */
export function pausedSeconds(session: RouteSession, now = Date.now()): number {
  let total = 0
  for (const pause of session.pauses ?? []) {
    const from = Date.parse(pause.at)
    const to = pause.until ? Date.parse(pause.until) : now
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) total += (to - from) / 1000
  }
  return total
}

export async function pauseSession(id: string, at: string): Promise<RouteSession | null> {
  const db = await getDb()
  const existing = (await db.get(SESSIONS, id)) as RouteSession | undefined
  if (!existing || existing.endedAt) return null
  // Pausing twice is pausing once. The second tap is a rep checking it took.
  if (openPause(existing)) return existing

  const next: RouteSession = { ...existing, pauses: [...(existing.pauses ?? []), { at }] }
  await db.put(SESSIONS, next)
  await queue('routeSession', next.id)
  return next
}

export async function resumeSession(id: string, at: string): Promise<RouteSession | null> {
  const db = await getDb()
  const existing = (await db.get(SESSIONS, id)) as RouteSession | undefined
  if (!existing || existing.endedAt) return null
  const pauses = [...(existing.pauses ?? [])]
  const last = pauses[pauses.length - 1]
  if (!last || last.until) return existing
  pauses[pauses.length - 1] = { ...last, until: at }

  const next: RouteSession = { ...existing, pauses }
  await db.put(SESSIONS, next)
  await queue('routeSession', next.id)
  return next
}

export async function stopSession(
  id: string,
  at: string,
  reason: RouteSession['endedReason'] = 'stopped',
): Promise<RouteSession | null> {
  const db = await getDb()
  const existing = (await db.get(SESSIONS, id)) as RouteSession | undefined
  if (!existing) return null
  // Already closed: not an error, and not something to overwrite. A rep who
  // taps stop twice has stopped once.
  if (existing.endedAt) return existing

  // A route ended while paused closes the pause at the same instant, so the
  // break has a length instead of running to the end of time.
  const pauses = [...(existing.pauses ?? [])]
  const last = pauses[pauses.length - 1]
  if (last && !last.until) pauses[pauses.length - 1] = { ...last, until: at }

  const closed: RouteSession = {
    ...existing,
    endedAt: at,
    endedReason: reason,
    ...(pauses.length > 0 ? { pauses } : {}),
  }
  await db.put(SESSIONS, closed)
  await queue('routeSession', closed.id)
  return closed
}

/** The session currently open on this device, if there is one. */
export async function openSession(): Promise<RouteSession | null> {
  const db = await getDb()
  const all = (await db.getAll(SESSIONS)) as RouteSession[]
  const open = all.filter((s) => !s.endedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return open[0] ?? null
}

export async function readSession(id: string): Promise<RouteSession | null> {
  const db = await getDb()
  return ((await db.get(SESSIONS, id)) as RouteSession | undefined) ?? null
}

export async function listSessions(limit = 30): Promise<RouteSession[]> {
  const db = await getDb()
  const all = (await db.getAll(SESSIONS)) as RouteSession[]
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit)
}

/**
 * The id to stamp on work recorded right now, or undefined if no route is open.
 *
 * Deliberately cheap and deliberately unable to fail. It is called on the path
 * a rep takes fifty times a day, standing in a driveway, and a knock must never
 * be lost or delayed because an IndexedDB read went wrong. No route, or a
 * broken read, both mean the same thing to the record: this activity is not
 * attributed to a route. That is an honest absence, and far better than the
 * alternative of reconstructing it later from timestamps.
 *
 * A PAUSED route still returns its id. The pause suspends LOCATION RECORDING,
 * which is a promise about surveillance; it is not a claim that the rep stopped
 * working. If somebody pauses for lunch and knocks a door on the way back to
 * the truck, that knock happened on this route and belongs to it. The trail
 * will simply have a gap where it sits, and route-stats already reports paused
 * time and gap time separately rather than blending them.
 */
export async function openSessionId(): Promise<string | undefined> {
  try {
    const session = await openSession()
    return session?.id
  } catch {
    return undefined
  }
}

/**
 * The minimum a point must move, and the minimum time between points, before
 * one is kept.
 *
 * Both exist for the rep's battery and the honesty of the trail. A phone
 * standing still emits a cloud of jittering fixes; storing them would make a
 * doorstep conversation look like pacing, and would fill the queue with
 * hundreds of rows that say nothing.
 */
export const MIN_POINT_SPACING_METERS = 12
export const MIN_POINT_INTERVAL_MS = 15_000

export async function recordPoint(
  sessionId: string,
  point: Omit<RoutePoint, 'id' | 'sessionId'>,
): Promise<RoutePoint | null> {
  const session = await readSession(sessionId)
  // The load-bearing refusal. Without it this module could record a rep's
  // location at any time, and a later caller would eventually do so by mistake.
  if (!session || session.endedAt) return null
  // Paused means paused. The watch is also cleared in the hook, but a rep's
  // break must not depend on a component having unmounted cleanly.
  if (isPaused(session)) return null

  const row: RoutePoint = { ...point, id: newId(), sessionId }
  const db = await getDb()
  await db.put(POINTS, row)
  await queue('routePoint', row.id)
  return row
}

export async function readPoint(id: string): Promise<RoutePoint | null> {
  const db = await getDb()
  return ((await db.get(POINTS, id)) as RoutePoint | undefined) ?? null
}

export async function listPoints(sessionId: string): Promise<RoutePoint[]> {
  const db = await getDb()
  const rows = (await db.getAllFromIndex(POINTS, 'by-session', sessionId)) as RoutePoint[]
  return rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}
