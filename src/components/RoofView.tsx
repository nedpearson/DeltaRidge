import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { EagleViewImageryProvider } from '@/features/imagery/eagleview'
import { rankCaptures, freshnessLabel } from '@/features/imagery/selection'
import type { ImageryCapture } from '@/features/imagery/types'

const provider = new EagleViewImageryProvider()

export default function RoofView({
  address,
  latitude,
  longitude
}: {
  address?: string
  latitude: number
  longitude: number
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [captureInfo, setCaptureInfo] = useState<ImageryCapture | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await provider.searchCaptures({ latitude, longitude })
        if (!active) return

        if (!result.configured) {
          setError(result.message || 'EagleView is not configured.')
          return
        }

        if (result.captures.length === 0) {
          setError(result.message || 'No EagleView imagery found for this location.')
          return
        }

        const topCapture = rankCaptures(result.captures)[0]
        if (!topCapture) {
           setError('No valid captures available.')
           return
        }
        setCaptureInfo(topCapture)

        const blob = await provider.image(topCapture, { latitude, longitude })
        if (!active) return

        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load imagery.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [latitude, longitude])

  return (
    <div className="relative w-full aspect-[2/1] min-h-[300px] bg-bg-elevated rounded-2xl overflow-hidden border border-border-subtle group flex flex-col items-center justify-center text-center p-0">
      {imageUrl ? (
        <>
          <img src={imageUrl} alt="Roof view" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
          <div className="absolute bottom-4 left-4 text-left z-10">
            <h3 className="text-sm font-bold text-white drop-shadow-md">{address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}</h3>
            <p className="text-[11px] text-white/90 drop-shadow-md mt-0.5">
              {captureInfo && `${captureInfo.view.toUpperCase()} · ${freshnessLabel(captureInfo)}`}
            </p>
          </div>
          <div className="absolute bottom-4 right-4 z-10 flex gap-2">
            <Button variant="secondary" className="text-[11px] px-3 py-1.5 h-auto bg-black/40 border-white/20 text-white hover:bg-black/60 backdrop-blur-md">Order Report</Button>
          </div>
          <div className="absolute top-3 left-4 text-[10px] text-white/80 font-medium uppercase tracking-widest drop-shadow-md z-10">
            EagleView Connect
          </div>
        </>
      ) : (
        <div className="p-6 flex flex-col items-center justify-center w-full h-full">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-text-primary">EagleView Imagery</h3>
            <p className="text-[13px] text-text-secondary mt-1 max-w-md">
              {address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
            </p>
          </div>

          {loading ? (
            <div className="text-[12px] text-text-secondary animate-pulse">Querying EagleView captures...</div>
          ) : error ? (
            <div className="bg-status-danger/10 border border-status-danger/20 text-status-danger px-4 py-3 rounded-md text-[12px] font-medium max-w-sm w-full mb-4">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
