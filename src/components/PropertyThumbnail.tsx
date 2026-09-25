import { useEffect, useRef, useState } from 'react'
import { HOUSE_SPAN_METRES, hasBasemap, parcelFrame, propertySpanUrl } from '@/features/leads/basemap'
import { project } from '@/features/leads/map-projection'

/**
 * The roof, from above, on the card.
 *
 * A roofer's first question about a door is what the roof looks like: how many
 * planes, how steep, is there a tree over it, can a ladder get to the back. An
 * address cannot answer that and a street map cannot either. One satellite tile
 * can, before anyone drives out there.
 *
 * It only answers it if the frame is about ONE house, in BOTH directions. This
 * used to ask for a fixed zoom at a fixed pixel height, which gave two separate
 * problems: on a wide card the frame covered about 150 metres across — four or
 * five lots, with nothing to say which roof the card was about — and the fixed
 * 128-pixel height made it a 4.75:1 letterbox on a desktop, so the 70 metres
 * across came with only 15 metres top to bottom and the roof ran off both
 * edges.
 *
 * So: the frame is asked for as a width of GROUND, the element measures itself,
 * and its aspect is fixed at 2:1 rather than its height. "One house and its
 * neighbours" now means the same thing on a phone and on a desktop, the roof
 * fits vertically, and the subject is always dead centre.
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
  boundary,
  alt,
  className = 'aspect-[2/1] w-auto',
  /** Tapping the image opens a bigger, zoomable view of the same roof. */
  onOpen,
}: {
  latitude: number | undefined
  longitude: number | undefined
  /** The parish's own lot outline, when there is one. */
  boundary?: ReadonlyArray<readonly [number, number]> | undefined
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

  // Prefer the parish's lot outline. The coordinate we hold is the ring
  // centroid, which on a deep wooded lot sits in the back garden — a frame
  // centred there is a tidy picture of somebody's trees.
  const framed = boundary && size.width > 0 ? parcelFrame(boundary, size) : null
  const url = framed
    ? framed.url
    : size.width > 0
      ? propertySpanUrl(latitude, longitude, size, HOUSE_SPAN_METRES)
      : null

  const outline =
    framed && boundary
      ? boundary
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => project({ longitude: p[0], latitude: p[1] }, framed.view, size))
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(' ')
      : null

  // `-mx-4 -mt-4` bleeds the image to the card's edges. The aspect sets the
  // height from that width — NOT a max-height, which fights the aspect ratio
  // and ends up shrinking the width instead, leaving the image short of the
  // card's right edge.
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

      {outline && (
        <svg className="pointer-events-none absolute inset-0" width={size.width} height={size.height}>
          <polygon
            points={outline}
            fill="rgba(245, 158, 11, 0.10)"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* A hairline crosshair at dead centre, only when there is no lot to
          outline. A pin would cover the roof, which is the one thing this
          image exists to show. */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
          outline ? 'hidden' : ''
        }`}
      >
        <div className="relative size-10 opacity-80">
          <div className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-white" />
          <div className="absolute bottom-0 left-1/2 h-2.5 w-px -translate-x-1/2 bg-white" />
          <div className="absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-white" />
          <div className="absolute right-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-white" />
        </div>
      </div>

      {onOpen && (
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 backdrop-blur-sm">
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
