import { useCallback, useEffect, useRef, useState } from 'react'
import { pendingWork, syncOutbox, type SyncResult } from '@/lib/sync/index'
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
export function useSync() {
  const { session, membership } = useSession()
  const [pending, setPending] = useState(0)
  const [stalled, setStalled] = useState<OutboxItem[]>([])
  const [last, setLast] = useState<SyncResult | null>(null)
  const [running, setRunning] = useState(false)
  const inFlight = useRef(false)

  const refreshPending = useCallback(() => {
    void pendingWork()
      .then(({ total }) => setPending(total))
      .catch(() => undefined)
    void listStalledOutbox().then(setStalled).catch(() => undefined)
  }, [])

  const run = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    try {
      const result = await syncOutbox(membership?.organizationId ?? null, session?.user.id ?? null)
      setLast(result)
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

  return { pending, stalled, last, running, syncNow: run, retryFailed }
}
