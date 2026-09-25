import { useEffect, useState } from 'react'

/** Renders a Blob, revoking its object URL on unmount so a long gallery of
 *  roof photos does not leak memory on a phone. */
export default function PhotoThumb({ blob, alt, className = '' }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return <div className={`animate-pulse bg-slate-100 hover:bg-slate-200 ${className}`} />
  return <img src={url} alt={alt} loading="lazy" className={className} />
}
