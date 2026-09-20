import { useEffect, useState } from 'react'
import {
  applyUpdate,
  shouldApplyNow,
  subscribeToUpdates,
  type UpdateState,
} from '@/lib/sw-update'

/**
 * Applies a waiting service worker as soon as it is safe, and explains itself
 * when it is not.
 *
 * The previous version only ever asked. That is why a deploy could sit unused
 * for days: the worker installed, parked in `waiting`, and the banner was easy
 * to scroll past - verified in the field, where the app was still serving the
 * bundle from the deploy before last. Now the default is to update, and the
 * prompt exists only for the case where updating would interrupt something.
 *
 * The short countdown is not decoration. A page that reloads the instant you
 * open it feels broken; a few seconds with a visible reason and a way out does
 * not.
 */
const GRACE_SECONDS = 5

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ available: false, holds: [] })
  const [countdown, setCountdown] = useState<number | null>(null)
  const [deferred, setDeferred] = useState(false)

  useEffect(() => subscribeToUpdates(setState), [])

  const autoApplies = shouldApplyNow(state) && !deferred

  useEffect(() => {
    if (!autoApplies) {
      setCountdown(null)
      return
    }
    setCountdown(GRACE_SECONDS)
    const timer = window.setInterval(() => {
      setCountdown((n) => {
        if (n === null) return null
        if (n <= 1) {
          window.clearInterval(timer)
          applyUpdate()
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoApplies])

  if (!state.available) return null

  const held = state.holds.length > 0
  const reason = state.holds[0]

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[min(26rem,calc(100%-2rem))]">
      <div className="flex items-center gap-3 rounded-xl bg-[#1b2740] px-4 py-3 shadow-lg ring-1 ring-sky-400/25">
        <p className="flex-1 text-[13px] leading-snug text-white/75">
          {held ? (
            <>
              A new version is ready. It will install by itself when you finish
              {reason ? ` — ${reason}` : ''}. Your saved work is untouched.
            </>
          ) : deferred ? (
            <>A new version is ready. Your saved work is untouched.</>
          ) : (
            <>Updating in {countdown ?? GRACE_SECONDS}s. Your saved work is untouched.</>
          )}
        </p>
        {!held && !deferred && (
          <button
            onClick={() => setDeferred(true)}
            className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-white/50"
          >
            Not now
          </button>
        )}
        <button
          onClick={applyUpdate}
          className="shrink-0 rounded-lg bg-sky-400/15 px-3 py-2 text-[13px] font-semibold text-sky-200 ring-1 ring-sky-400/30"
        >
          {held || deferred ? 'Update now' : 'Update'}
        </button>
      </div>
    </div>
  )
}
