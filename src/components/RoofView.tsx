import { useEffect, useRef, useState } from 'react'
import {
  BASEMAP_ATTRIBUTION,
  HOUSE_SPAN_METRES,
  SPAN_STEPS_METRES,
  hasBasemap,
  propertySpanUrl,
  spanFeet,
} from '@/features/leads/basemap'

/**
 * One roof, from above, at a zoom the rep chooses.
 *
 * Two things a roofer actually does with an aerial before driving out: work out
 * the shape of the roof — how many planes, how steep, what is over it — and
 * work out where the house sits on its lot, for the ladder and the truck. Those
 * want different framings, so the framing is a control rather than a decision
 * somebody else made.
 *
 * Every frame is centred on the coordinate the app has for this door, so the
 * subject is always dead centre. That is why the marker is a hairline crosshair
 * and not a pin: a pin would sit on top of the one thing the image was opened
 * to look at.
 *
 * The frame is asked for as a WIDTH OF GROUND, not a zoom level, so "this much
 * of the street" means the same thing on a phone card and on a desktop panel.
 */

const DEFAULT_STEP = SPAN_STEPS_METRES.indexOf(HOUSE_SPAN_METRES as (typeof SPAN_STEPS_METRES)[number])

export default function RoofView({
  latitude,
  longitude,
  address,
  height = 260,
  /** Where the zoom starts, as an index into SPAN_STEPS_METRES. */
  initialStep = DEFAULT_STEP < 0 ? 2 : DEFAULT_STEP,
  onClose,
}: {
  latitude: number
  longitude: number
  address: string
  height?: number
  initialStep?: number
  onClose?: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [step, setStep] = useState(initialStep)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const span = SPAN_STEPS_METRES[step] ?? HOUSE_SPAN_METRES
  const url = width > 0 ? propertySpanUrl(latitude, longitude, { width, height }, span) : null

  const canZoomIn = step > 0
  const canZoomOut = step < SPAN_STEPS_METRES.length - 1

  if (!hasBasemap()) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center">
        <p className="text-[13px] text-white/45">No satellite imagery is configured for this app.</p>
      </div>
    )
  }

  return (
    <div>
      <div
        ref={box}
        className="relative overflow-hidden rounded-2xl bg-[var(--color-surface-3)] ring-1 ring-white/8"
        style={{ height }}
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
            <p className="text-[12.5px] leading-relaxed text-white/45">
              The imagery for this address did not load. Everything else about the door is unaffected.
            </p>
          </div>
        )}

        {/*
          A hairline crosshair at dead centre, not a pin. The frame is centred on
          this door's own coordinate, so the centre IS the house — and a pin
          would cover the roof, which is the whole reason anyone opened this.
        */}
        {!failed && (
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

        {/* The readout is the point of framing by distance: a rep can judge a
            roof against a number they already think in. */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10.5px] text-white/70 backdrop-blur-sm">
          about {spanFeet(span)} ft across
        </div>
      </div>

      <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/30">
        Centred on this address. {BASEMAP_ATTRIBUTION}
      </p>
    </div>
  )
}
