import RoofImageryPanel from '@/features/imagery/RoofImageryPanel'

/**
 * The roof, full width, over whatever the rep was looking at.
 *
 * A sheet rather than a new screen on purpose: a rep checking whether a roof is
 * worth the walk is mid-decision about the door in front of them, and taking
 * them to another route and back would lose their place in a 150-door list.
 */
export default function RoofViewSheet({
  latitude,
  longitude,
  address,
  onClose,
}: {
  latitude: number
  longitude: number
  address: string
  boundary?: ReadonlyArray<readonly [number, number]> | undefined
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[92vh] w-full max-w-screen-sm overflow-y-auto rounded-t-3xl bg-[var(--color-surface-2)] p-4 pb-8 ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-slate-600">EagleView Roof Imagery</p>
            <p className="mt-0.5 truncate text-[15px] font-semibold">{address}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-slate-200 p-1 text-[13px] text-slate-600 hover:bg-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="mt-3">
          <RoofImageryPanel
            latitude={latitude}
            longitude={longitude}
            storms={[]}
            autoFetch
          />
        </div>
      </div>
    </div>
  )
}
