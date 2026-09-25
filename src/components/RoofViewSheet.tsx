import RoofView from '@/components/RoofView'

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
  boundary,
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
        // Same column the rest of the app lives in. A sheet is `fixed`, so it
        // escapes AppShell's max-width unless it is told not to — and a
        // full-bleed 1489-pixel sheet turns the 3:2 roof frame into a 3.4:1
        // letterbox the moment the max-height bites.
        className="max-h-[92vh] w-full max-w-screen-sm overflow-y-auto rounded-t-3xl bg-[var(--color-surface-2)] p-4 pb-8 ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <p className="text-[11px] uppercase tracking-wider text-slate-600">Roof</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold">{address}</p>

        <div className="mt-3">
          <RoofView
            latitude={latitude}
            longitude={longitude}
            address={address}
            boundary={boundary}
            onClose={onClose}
          />
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
          Imagery is whatever Mapbox last flew, which can be a year or two old. A roof that looks
          original here may already have been replaced — the permit record is the better answer to
          that, and it is on the door card.
        </p>
      </div>
    </div>
  )
}
