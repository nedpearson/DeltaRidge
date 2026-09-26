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
    <div
      className="fixed inset-x-0 z-50 mx-auto w-[min(26rem,calc(100%-2rem))]"
      /*
       * Sits above the nav by measurement rather than by the old hard-coded
       * `bottom-20`, which assumed a nav height that was already wrong and would
       * have put this banner on top of the nav on any phone with a home
       * indicator.
       */
      style={{
        bottom: 'calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px) + 0.75rem)',
      }}
    >
      <div className="flex items-center gap-3 rounded-xl bg-bg-card px-4 py-3 shadow-lg ring-1 ring-brand-primary">
        <p className="flex-1 text-[13px] leading-snug text-text-secondary">
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
            className="shrink-0 rounded-lg px-2 py-2 text-[13px] text-text-secondary"
          >
            Not now
          </button>
        )}
        <button
          onClick={applyUpdate}
          className="shrink-0 rounded-lg bg-sky-100 px-3 py-2 text-[13px] font-semibold text-sky-700 ring-1 ring-brand-primary"
        >
          {held || deferred ? 'Update now' : 'Update'}
        </button>
      </div>
    </div>
  )
}
