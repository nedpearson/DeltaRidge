export default function PropertyThumbnail({
  latitude,
  longitude,
  alt,
  className = 'aspect-[2/1] w-auto',
  onOpen,
}: {
  latitude: number | undefined
  longitude: number | undefined
  boundary?: ReadonlyArray<readonly [number, number]> | undefined
  alt: string
  className?: string
  onOpen?: () => void
}) {
  if (latitude === undefined || longitude === undefined) return null

  // We no longer rely on Mapbox Static Images.
  // This thumbnail represents the future EagleView aerial property capture.
  
  const image = (
    <div className={`relative -mx-4 -mt-4 mb-3 overflow-hidden bg-bg-app border-b border-border-subtle flex items-center justify-center ${className}`}>
      
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5" />
      
      <div className="text-center z-10">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">EagleView</p>
        <p className="text-[12px] text-text-secondary">Capture Pending</p>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative size-10 opacity-30">
          <div className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-text-muted" />
          <div className="absolute bottom-0 left-1/2 h-2.5 w-px -translate-x-1/2 bg-text-muted" />
          <div className="absolute left-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-text-muted" />
          <div className="absolute right-0 top-1/2 h-px w-2.5 -translate-y-1/2 bg-text-muted" />
        </div>
      </div>

      {onOpen && (
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-secondary shadow-sm">
          Expand
        </span>
      )}
    </div>
  )

  if (!onOpen) return image

  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Zoom ${alt}`}>
      {image}
    </button>
  )
}
