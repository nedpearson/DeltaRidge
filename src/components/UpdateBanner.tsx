import { useEffect, useState } from 'react'

type UpdateFn = (reload?: boolean) => Promise<void> | void

/**
 * Surfaces the waiting service worker.
 *
 * `registerType: 'prompt'` is deliberate — reloading under a rep who is halfway
 * through an inspection would be hostile. But a prompt nobody renders is worse
 * than no prompt at all: the new worker installs, parks in `waiting`, and the
 * rep keeps running an old build forever with no way to know. This is the
 * listener that makes the choice real.
 */
export default function UpdateBanner() {
  const [updateSW, setUpdateSW] = useState<UpdateFn | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onAvailable(event: Event) {
      const detail = (event as CustomEvent<{ updateSW: UpdateFn }>).detail
      if (detail?.updateSW) setUpdateSW(() => detail.updateSW)
    }
    window.addEventListener('dr:update-available', onAvailable)
    return () => window.removeEventListener('dr:update-available', onAvailable)
  }, [])

  if (!updateSW) return null

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 mx-auto w-[min(26rem,calc(100%-2rem))]">
      <div className="flex items-center gap-3 rounded-xl bg-[#1b2740] px-4 py-3 shadow-lg ring-1 ring-sky-400/25">
        <p className="flex-1 text-[13px] leading-snug text-white/75">
          A new version is ready. Your saved work is untouched.
        </p>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void updateSW(true)
          }}
          className="shrink-0 rounded-lg bg-sky-400/15 px-3 py-2 text-[13px] font-semibold text-sky-200 ring-1 ring-sky-400/30 disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  )
}
