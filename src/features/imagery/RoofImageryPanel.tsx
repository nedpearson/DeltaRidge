import { useEffect, useMemo, useState, type WheelEvent } from 'react'
import { assessImagery, captureLabel } from '@/features/claims/imagery-quality'
import type { StormEvent } from '@/integrations/storm'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { EagleViewImageryProvider } from './eagleview'
import {
  freshnessLabel,
  pairAroundStorm,
  rankCaptures,
  resolutionLabel,
  withinDays,
} from './selection'
import type { ImageryCapture } from './types'

type Freshness = 'best' | '7' | '30' | '90'

const provider = new EagleViewImageryProvider()

function date(iso: string | null): string {
  if (iso === null) return 'Date unavailable'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable'
  return parsed.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function captureFacts(capture: ImageryCapture) {
  return {
    gsdMetres: capture.gsdMetres,
    capturedFrom: capture.capturedFrom,
    capturedUntil: capture.capturedUntil,
    composite: capture.composite,
    source: 'EagleView',
    obstructedFraction: null,
  }
}

function ImagePane({
  capture,
  latitude,
  longitude,
  label,
}: {
  capture: ImageryCapture
  latitude: number
  longitude: number
  label?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    setError(null)
    setZoom(1)
    void provider.image(capture, { latitude, longitude }).then((blob) => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Image unavailable.')
    })
    return () => {
      active = false
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [capture, latitude, longitude])

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setZoom((value) => Math.min(6, Math.max(1, value + (event.deltaY < 0 ? 0.5 : -0.5))))
  }

  return (
    <div className="min-w-0">
      {label && <p className="mb-1 font-display text-[10px] tracking-widest text-white/45">{label}</p>}
      <div
        className="relative aspect-[4/3] overflow-auto rounded-xl bg-black/40 ring-1 ring-white/10"
        onWheel={wheel}
      >
        {url !== null ? (
          <img
            src={url}
            alt={`${capture.view} EagleView roof capture`}
            className="h-full w-full origin-center object-contain"
            style={{ transform: `scale(${zoom})` }}
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center text-[12px] text-white/40">
            {error ?? 'Opening full-resolution image…'}
          </div>
        )}
        <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white/70">
          {zoom.toFixed(1)}× · native detail only
        </div>
      </div>
      <input
        aria-label="Image zoom"
        type="range"
        min="1"
        max="6"
        step="0.25"
        value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}
        className="mt-2 w-full accent-amber-400"
      />
    </div>
  )
}

export default function RoofImageryPanel({
  latitude,
  longitude,
  storms,
  autoFetch = false,
}: {
  latitude: number
  longitude: number
  storms: readonly StormEvent[]
  autoFetch?: boolean
}) {
  const [all, setAll] = useState<readonly ImageryCapture[]>([])
  const [selected, setSelected] = useState<ImageryCapture | null>(null)
  const [filter, setFilter] = useState<Freshness>('best')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)

  const latestStorm = useMemo(
    () => [...storms].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null,
    [storms],
  )
  const captures = useMemo(
    () => withinDays(all, filter === 'best' ? null : Number(filter)),
    [all, filter],
  )
  const pair = useMemo(
    () => latestStorm === null ? { before: null, after: null } : pairAroundStorm(all, latestStorm.occurredAt),
    [all, latestStorm],
  )

  useEffect(() => {
    if (captures.length === 0) return
    if (selected === null || !captures.some((capture) => capture.imageUrn === selected.imageUrn)) {
      setSelected(captures[0] ?? null)
      setCompare(false)
    }
  }, [captures, selected])

  const search = async () => {
    if (searched || loading) return
    setLoading(true)
    setMessage(null)
    setCompare(false)
    const result = await provider.searchCaptures({ latitude, longitude })
    const ranked = rankCaptures(result.captures)
    setAll(ranked)
    setSelected(ranked[0] ?? null)
    setMessage(result.message)
    setSearched(true)
    setLoading(false)
  }

  useEffect(() => {
    if (autoFetch && !searched && !loading) {
      void search()
    }
  }, [autoFetch, searched, loading])

  const verdict = selected === null
    ? null
    : assessImagery(captureFacts(selected), 'hail_impact', { occurredAt: latestStorm?.occurredAt ?? null })

  return (
    <>
      <SectionTitle hint="EagleView is queried only when you ask, so paid imagery is not requested while scrolling.">
        ROOF IMAGERY INTELLIGENCE
      </SectionTitle>
      <Card>
        {!searched ? (
          <div className="text-center">
            <p className="text-[12.5px] leading-relaxed text-white/55">
              Search your EagleView imagery entitlement for the freshest captures at this roof.
            </p>
            <div className="mt-3"><Button variant="gold" onClick={() => void search()} disabled={loading}>SEARCH EAGLEVIEW</Button></div>
          </div>
        ) : all.length === 0 ? (
          <Empty
            title="No EagleView capture returned"
            body={message ?? 'This account has no qualifying imagery at this location.'}
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {([['best', 'Best available'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-1 text-[11px] ${filter === value ? 'bg-gold-500/20 text-gold-300' : 'bg-white/6 text-white/50'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {captures.length === 0 ? (
              <p className="mt-4 text-[12.5px] text-white/45">
                No image satisfies that freshness window. Best available: {date(all[0]?.capturedFrom ?? null)}.
              </p>
            ) : selected !== null ? (
              <div className="mt-4">
                {compare && pair.before !== null && pair.after !== null ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ImagePane capture={pair.before} latitude={latitude} longitude={longitude} label={`BEFORE · ${date(pair.before.capturedUntil ?? pair.before.capturedFrom)}`} />
                    <ImagePane capture={pair.after} latitude={latitude} longitude={longitude} label={`AFTER · ${date(pair.after.capturedUntil ?? pair.after.capturedFrom)}`} />
                  </div>
                ) : (
                  <ImagePane capture={selected} latitude={latitude} longitude={longitude} />
                )}

                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] text-white/90">{captureLabel(captureFacts(selected))}</p>
                    <p className="text-[11px] text-white/45">
                      {resolutionLabel(selected.gsdMetres)} · {selected.view.toUpperCase()} · {freshnessLabel(selected)}
                      {selected.disaster ? ' · post-disaster capture' : ''}
                    </p>
                  </div>
                  {latestStorm !== null && pair.before !== null && pair.after !== null && (
                    <Button variant="secondary" onClick={() => setCompare((value) => !value)}>
                      {compare ? 'LATEST VIEW' : 'COMPARE STORM'}
                    </Button>
                  )}
                </div>

                {verdict !== null && !verdict.ok && (
                  <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
                    <p className="font-display text-[10px] tracking-widest text-amber-300">FIELD VERIFICATION REQUIRED</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-white/55">{verdict.reason}</p>
                    <p className="mt-1 text-[11px] text-white/35">Use instead: {verdict.instead}</p>
                  </div>
                )}

                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-white/8 pt-2">
                  {captures.map((capture) => (
                    <button
                      key={`${capture.captureId}-${capture.view}-${capture.imageUrn}`}
                      onClick={() => { setSelected(capture); setCompare(false) }}
                      className={`flex w-full justify-between gap-3 rounded-lg px-2 py-2 text-left ${selected.imageUrn === capture.imageUrn ? 'bg-white/8' : 'hover:bg-white/5'}`}
                    >
                      <span className="text-[11.5px] text-white/70">{date(capture.capturedUntil ?? capture.capturedFrom)} · {capture.view}</span>
                      <span className="shrink-0 text-[10.5px] text-white/35">{resolutionLabel(capture.gsdMetres)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  )
}
