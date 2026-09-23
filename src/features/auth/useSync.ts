import { useCallback, useEffect, useRef, useState } from 'react'
import { pendingWork, syncOutbox, type SyncResult } from '@/lib/sync/index'
import { pullLeads, type PullResult } from '@/lib/sync/pull'
import { listStalledOutbox, retryStalledOutbox } from '@/lib/sync-store'
import type { OutboxItem } from '@/lib/db'
import { useSession } from './session'

/**
 * Drains the outbox when it can, and never while offline or signed out.
 *
 * Deliberately conservative: one drain at a time, on an interval and on
 * regaining connectivity. A rep is not waiting on this — their work is already
 * safe locally — so there is no reason to be aggressive about it.
 *
 * `stalled` is the part that matters to a rep. Items that have exhausted their
 * retries stop being attempted, and a queue that has quietly stopped trying
 * looks exactly like a queue that lost the work. These are surfaced with their
 * error and a manual retry rather than being left to a background loop nobody
 * can see.
 */
/** How often a background drain is also allowed to read the server back. */
const PULL_INTERVAL_MS = 120_000

export function useSync() {
  const { session, membership } = useSession()
  const [pending, setPending] = useState(0)
  const [foreign, setForeign] = useState(0)
  const [blocked, setBlocked] = useState(0)
  const [stalled, setStalled] = useState<OutboxItem[]>([])
  const [last, setLast] = useState<SyncResult | null>(null)
  const [lastPull, setLastPull] = useState<PullResult | null>(null)
  const lastPullAt = useRef(0)
  const [running, setRunning] = useState(false)
  const inFlight = useRef(false)

  const userId = session?.user.id ?? null

  const refreshPending = useCallback(() => {
    void pendingWork(userId)
      .then(({ total, foreign: f, blocked: b }) => {
        setPending(total)
        setForeign(f)
        setBlocked(b)
      })
      .catch(() => undefined)
    void listStalledOutbox().then(setStalled).catch(() => undefined)
  }, [userId])

  const run = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    try {
      const orgId = membership?.organizationId ?? null
      const uid = session?.user.id ?? null
      // Push first, always. The device's unsent work is the newer story, and
      // pulling before pushing would compare a local row against a server row
      // that does not yet know about the knock sitting in the queue.
      const result = await syncOutbox(orgId, uid)
      setLast(result)

      // Throttled separately from the push. A drain is cheap and runs every
      // 30 seconds; a pull reads the organisation's whole pipeline, and doing
      // that twice a minute on a phone with one bar is how an app becomes the
      // reason the battery died.
      if (orgId && uid && Date.now() - lastPullAt.current > PULL_INTERVAL_MS) {
        lastPullAt.current = Date.now()
        setLastPull(await pullLeads(orgId, uid))
      }
    } finally {
      inFlight.current = false
      setRunning(false)
      refreshPending()
    }
  }, [membership, session, refreshPending])

  /** Clears the give-up flag on stalled items and drains immediately. */
  const retryFailed = useCallback(async () => {
    await retryStalledOutbox()
    await run()
  }, [run])

  useEffect(() => {
    refreshPending()
    const onOnline = () => void run()
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => {
      refreshPending()
      if (navigator.onLine && session && membership) void run()
    }, 30000)
    if (session && membership) void run()
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [run, refreshPending, session, membership])

  /** Forces a pull now, for the diagnostics screen's explicit button. */
  const pullNow = useCallback(async () => {
    const orgId = membership?.organizationId ?? null
    const uid = session?.user.id ?? null
    lastPullAt.current = Date.now()
    setLastPull(await pullLeads(orgId, uid))
  }, [membership, session])

  return {
    pending,
    stalled,
    foreign,
    blocked,
    last,
    lastPull,
    running,
    syncNow: run,
    pullNow,
    retryFailed,
  }
}
