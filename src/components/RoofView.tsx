import { useEffect, useRef, useState } from 'react'
import {
  BASEMAP_ATTRIBUTION,
  HOUSE_SPAN_METRES,
  SPAN_STEPS_METRES,
  hasBasemap,
  parcelFrame,
  propertySpanUrl,
  spanFeet,
} from '@/features/leads/basemap'
import { project } from '@/features/leads/map-projection'

/**
 * One roof, from above, at a zoom the rep chooses.
 *
 * Two things a roofer actually does with an aerial before driving out: work out
 * the shape of the roof — how many planes, how steep, what is over it — and
 * work out where the house sits on its lot, for the ladder and the truck. Those
 * want different framings, so the framing is a control rather than a decision
 * somebody else made.
 *
 * Two ways of framing it, in order of preference.
 *
 * When the parish gave us the lot's boundary — which it does for most of East
 * Baton Rouge — the frame is the LOT, at the lot's own size, with its outline
 * drawn on top. That settles which house is the subject outright, and it is
 * worth preferring for a specific reason: the coordinate we hold is the ring
 * centroid, and on a deep wooded lot the centroid sits in the back garden. A
 * frame centred there is a tidy picture of somebody's trees.
 *
 * Otherwise the frame is a fixed width of GROUND around that coordinate, which
 * at least means the same thing on a phone card and on a desktop panel, with a
 * hairline crosshair at centre. A crosshair rather than a pin, because a pin
 * would sit on top of the one thing the image was opened to look at.
 */

const DEFAULT_STEP = SPAN_STEPS_METRES.indexOf(HOUSE_SPAN_METRES as (typeof SPAN_STEPS_METRES)[number])

export default function RoofView({
  latitude,
  longitude,
  address,
  /** The parish's own lot outline, when there is one. */
  boundary,
  /**
   * Width-to-height of the frame, not a pixel height.
   *
   * A fixed height is how the card thumbnail ended up a 4.75:1 letterbox on a
   * desktop: 70 metres across with 15 metres top to bottom, which is a strip of
   * roof rather than a roof. Fixing the ratio keeps both dimensions about one
   * house whatever the element is.
   */
  aspect = 3 / 2,
  /** Stops the frame running off the screen on a wide display. */
  maxHeight = '60vh',
  /** Where the zoom starts, as an index into SPAN_STEPS_METRES. */
  initialStep = DEFAULT_STEP < 0 ? 2 : DEFAULT_STEP,
  onClose,
}: {
  latitude: number
  longitude: number
  address: string
  boundary?: ReadonlyArray<readonly [number, number]> | undefined
  aspect?: number
  maxHeight?: string
  initialStep?: number
  onClose?: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [step, setStep] = useState(initialStep)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element) return
    // BOTH dimensions, read back from the browser rather than computed from the
    // width. On a wide screen the max-height caps the frame, and a height
    // derived from width × aspect would then be 993 px for a box that is
    // actually 450 — the image would hang off the top of the viewport, which is
    // exactly what it did.
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const { width, height } = size
  const span = SPAN_STEPS_METRES[step] ?? HOUSE_SPAN_METRES

  // The zoom control moves through spans either way; against a lot boundary it
  // widens from the lot rather than from a fixed distance.
  const zoomOut = span / HOUSE_SPAN_METRES
  const framed = boundary && width > 0 ? parcelFrame(boundary, size, zoomOut) : null
  const url = framed
    ? framed.url
    : width > 0
      ? propertySpanUrl(latitude, longitude, size, span)
      : null

  // What the frame actually holds vertically, which is the dimension that
  // decides whether a whole roof is on screen.
  const tallSpan = height > 0 ? (span * height) / width : 0

  const outline =
    framed && boundary
      ? boundary
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => project({ longitude: p[0], latitude: p[1] }, framed.view, size))
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(' ')
      : null

  const canZoomIn = step > 0
  const canZoomOut = step < SPAN_STEPS_METRES.length - 1

  if (!hasBasemap()) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center">
        <p className="text-[13px] text-[var(--color-ink)]/">No satellite imagery is configured for this app.</p>
      </div>
    )
  }

  return (
    <div>
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-2xl bg-[var(--color-surface-3)] ring-1 ring-slate-200"
        // w-full with an aspect ratio and a max height: the width stays full and
        // only the height is capped. Capping with max-h alone makes the browser
        // honour the ratio by shrinking the WIDTH instead.
        style={{ aspectRatio: `${aspect}`, maxHeight }}
      >
        {url && !failed && (
          <img
            key={url}
            src={url}
            alt={`Aerial view of ${address}`}
            decoding="async"
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        )}

        {failed && (
          <div className="flex size-full items-center justify-center px-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-[var(--color-ink)]/">
              The imagery for this address did not load. Everything else about the door is unaffected.
            </p>
          </div>
        )}

        {/* The lot, as the parish recorded it. Drawn over the image rather than
            baked into the request, so the outline stays crisp at any size. */}
        {outline && !failed && (
          <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
            <polygon
              points={outline}
              fill="rgba(245, 158, 11, 0.10)"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
        )}

        {/*
          A hairline crosshair at dead centre, not a pin — only when there is no
          boundary to draw. The frame is centred on this door's own coordinate,
          so the centre is the best guess available, and a pin would cover the
          roof, which is the whole reason anyone opened this.
        */}
        {!outline && !failed && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative size-14">
              <div className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-white/80" />
              <div className="absolute bottom-0 left-1/2 h-3.5 w-px -translate-x-1/2 bg-white/80" />
              <div className="absolute left-0 top-1/2 h-px w-3.5 -translate-y-1/2 bg-white/80" />
              <div className="absolute right-0 top-1/2 h-px w-3.5 -translate-y-1/2 bg-white/80" />
            </div>
          </div>
        )}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={!canZoomIn}
            aria-label="Zoom in"
            className="size-9 rounded-lg bg-black/60 text-[18px] font-semibold text-white backdrop-blur-sm disabled:opacity-30"
          >
            +
          </button>
          <button
            onClick={() => setStep((s) => Math.min(SPAN_STEPS_METRES.length - 1, s + 1))}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            className="size-9 rounded-lg bg-black/60 text-[18px] font-semibold text-white backdrop-blur-sm disabled:opacity-30"
          >
            −
          </button>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute left-2 top-2 size-9 rounded-lg bg-black/60 text-[15px] text-white backdrop-blur-sm"
          >
            ✕
          </button>
        )}

        {/*
          Top-left, not bottom-left. Mapbox's terms require its logo and
          attribution to stay visible, and both sit in the bottom corners of the
          image it serves — a badge down there covers the logo.

          The readout is the point of framing by distance: a rep can judge a
          roof against a number they already think in.
        */}
        <div
          className="pointer-events-none absolute top-2 rounded bg-black/60 px-2 py-1 text-[10.5px] text-[var(--color-ink)]/ backdrop-blur-sm"
          // Clear of the close button when there is one.
          style={{ left: onClose ? '3.25rem' : '0.5rem' }}
        >
          {framed ? 'this lot' : `about ${spanFeet(span)} × ${spanFeet(tallSpan)} ft`}
        </div>
      </div>

      <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--color-ink)]/">
        {framed
          ? 'Outline is the parish parcel record, not a survey.'
          : 'Centred on this address — the parish has no lot outline for it.'}{' '}
        {BASEMAP_ATTRIBUTION}
      </p>
    </div>
  )
}
