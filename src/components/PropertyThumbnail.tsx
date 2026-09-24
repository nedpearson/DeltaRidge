import { useEffect, useRef, useState } from 'react'
import { HOUSE_SPAN_METRES, hasBasemap, propertySpanUrl } from '@/features/leads/basemap'

/**
 * The roof, from above, on the card.
 *
 * A roofer's first question about a door is what the roof looks like: how many
 * planes, how steep, is there a tree over it, can a ladder get to the back. An
 * address cannot answer that and a street map cannot either. One satellite tile
 * can, before anyone drives out there.
 *
 * It only answers it if the frame is about ONE house. This used to ask for a
 * fixed zoom at a fixed pixel size, which on a wide card covered about 120
 * metres — four or five lots — with nothing to say which roof the card was
 * about. Now the frame is asked for as a width of GROUND and the element
 * measures itself, so "one house and its neighbours" means the same thing on a
 * phone and on a desktop, and the subject is always dead centre.
 *
 * Three states, all of them silent about the others:
 *
 *   * no Mapbox token   — nothing is drawn, and the card is still complete.
 *   * no coordinates    — same. A door with no parcel match still knocks.
 *   * the image errors  — it is replaced, not left as a broken-image icon.
 *
 * `loading="lazy"` matters more than it looks: a list of 150 doors would
 * otherwise fire 150 image requests on mount, on a phone, on parish wifi.
 */
export default function PropertyThumbnail({
  latitude,
  longitude,
  alt,
  className = 'h-32',
  /** Tapping the image opens a bigger, zoomable view of the same roof. */
  onOpen,
}: {
  latitude: number | undefined
  longitude: number | undefined
  alt: string
  className?: string
  onOpen?: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (latitude === undefined || longitude === undefined) return null
  if (!hasBasemap() || failed) return null

  const url =
    size.width > 0 ? propertySpanUrl(latitude, longitude, size, HOUSE_SPAN_METRES) : null

  const image = (
    <div ref={box} className={`relative -mx-4 -mt-4 mb-3 overflow-hidden ${className}`}>
      {url && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}

      {/* A hairline crosshair at dead centre. The frame is centred on this
          door's coordinate, so the centre is the house — and a pin would cover
          the roof, which is the one thing this image exists to show. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative size-10 opacity-80">
          <div className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-white" />
          <div className="absolute bottom-0 left-1/2 h-2.5 w-px -translate-x-1/2 bg-white" />
          <div className="absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-white" />
          <div className="absolute right-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-white" />
        </div>
      </div>

      {onOpen && (
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
          Zoom
        </span>
      )}

      {/* The card's text sits under this; the gradient keeps it readable over
          a bright roof or a white driveway. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )

  if (!onOpen) return image

  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Zoom ${alt}`}>
      {image}
    </button>
  )
}
