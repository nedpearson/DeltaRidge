import { useCallback, useEffect, useRef, useState } from 'react'
import { syncOutbox, type SyncResult } from '@/lib/sync'
import { outboxCount } from '@/lib/db'
import { useSession } from './session'

/**
 * Drains the outbox when it can, and never while offline or signed out.
 *
 * Deliberately conservative: one drain at a time, on an interval and on
 * regaining connectivity. A rep is not waiting on this — their work is already
 * safe locally — so there is no reason to be aggressive about it.
 */
export function useSync() {
  const { session, membership } = useSession()
  const [pending, setPending] = useState(0)
  const [last, setLast] = useState<SyncResult | null>(null)
  const [running, setRunning] = useState(false)
  const inFlight = useRef(false)

  const refreshPending = useCallback(() => {
    void outboxCount().then(setPending).catch(() => undefined)
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

  return { pending, last, running, syncNow: run }
}
