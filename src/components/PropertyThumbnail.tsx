import { useState } from 'react'
import { hasBasemap, propertyImageUrl } from '@/features/leads/basemap'

/**
 * The roof, from above, on the card.
 *
 * A roofer's first question about a door is what the roof looks like: how many
 * planes, how steep, is there a tree over it, can a ladder get to the back. An
 * address cannot answer that and a street map cannot either. One satellite tile
 * can, before anyone drives out there.
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
}: {
  latitude: number | undefined
  longitude: number | undefined
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (latitude === undefined || longitude === undefined) return null
  if (!hasBasemap() || failed) return null

  // Requested at the card's own aspect, not a square that gets cropped by CSS —
  // a crop moves the house off centre, which is the one thing this image is for.
  const url = propertyImageUrl(latitude, longitude, { width: 480, height: 256 })
  if (!url) return null

  return (
    <div className={`relative -mx-4 -mt-4 mb-3 overflow-hidden ${className}`}>
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
      {/* The card's text sits under this; the gradient keeps it readable over
          a bright roof or a white driveway. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )
}
