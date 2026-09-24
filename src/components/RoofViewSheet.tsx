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
  onClose,
}: {
  latitude: number
  longitude: number
  address: string
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full rounded-t-3xl bg-[var(--color-surface-2)] p-4 pb-8 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <p className="text-[11px] uppercase tracking-wider text-white/35">Roof</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold">{address}</p>

        <div className="mt-3">
          <RoofView
            latitude={latitude}
            longitude={longitude}
            address={address}
            height={300}
            onClose={onClose}
          />
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-white/35">
          Imagery is whatever Mapbox last flew, which can be a year or two old. A roof that looks
          original here may already have been replaced — the permit record is the better answer to
          that, and it is on the door card.
        </p>
      </div>
    </div>
  )
}
