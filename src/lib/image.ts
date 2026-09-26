/**
 * Client-side image processing and quality assessment.
 *
 * The quality checks here are deliberately NOT AI. They are cheap numeric
 * heuristics that run on-device, offline, in milliseconds — which is exactly
 * when a rep needs them: standing on the roof, before they climb down. An AI
 * pass can refine this later, but a blurry photo should be caught without a
 * network round-trip or an API key.
 */

export interface ProcessedImage {
  full: Blob
  thumbnail: Blob
  width: number
  height: number
  byteSize: number
  quality: QualityAssessment
}

export interface QualityAssessment {
  /** null when the photo looks fine. */
  flag: 'blurry' | 'dark' | 'glare' | null
  retakeRecommended: boolean
  /** Plain-language reason shown to the rep. Never jargon. */
  reason?: string
  metrics: { sharpness: number; brightness: number; blownHighlights: number }
}

/**
 * Thresholds tuned for phone photos of roofs in daylight. They are intentionally
 * forgiving: a false "retake" prompt costs one tap, but nagging a rep on good
 * photos trains them to ignore the warning entirely, which defeats the feature.
 */
const SHARPNESS_FLOOR = 55
const DARK_CEILING = 55
const GLARE_RATIO = 0.3

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file)
}

function canvasOf(width: number, height: number): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D context unavailable on this device.')
  return { canvas, ctx }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image.'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Variance of the Laplacian over a grayscale downsample — the standard cheap
 * focus measure. Low variance means few sharp edges, which means blur.
 */
function assessQuality(ctx: CanvasRenderingContext2D, w: number, h: number): QualityAssessment {
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Float32Array(w * h)
  let brightnessSum = 0
  let blown = 0

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    gray[p] = lum
    brightnessSum += lum
    if (lum > 247) blown += 1
  }

  const pixelCount = w * h
  const brightness = brightnessSum / pixelCount
  const blownHighlights = blown / pixelCount

  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x
      const lap =
        -4 * (gray[i] ?? 0) +
        (gray[i - 1] ?? 0) +
        (gray[i + 1] ?? 0) +
        (gray[i - w] ?? 0) +
        (gray[i + w] ?? 0)
      sum += lap
      sumSq += lap * lap
      n += 1
    }
  }
  const mean = n > 0 ? sum / n : 0
  const sharpness = n > 0 ? sumSq / n - mean * mean : 0

  const metrics = {
    sharpness: Math.round(sharpness),
    brightness: Math.round(brightness),
    blownHighlights: Number(blownHighlights.toFixed(3)),
  }

  if (sharpness < SHARPNESS_FLOOR) {
    return {
      flag: 'blurry',
      retakeRecommended: true,
      reason: 'This looks out of focus — the damage will not be clear enough to document.',
      metrics,
    }
  }
  if (brightness < DARK_CEILING) {
    return {
      flag: 'dark',
      retakeRecommended: true,
      reason: 'This came out very dark. Try again facing away from the sun.',
      metrics,
    }
  }
  if (blownHighlights > GLARE_RATIO) {
    return {
      flag: 'glare',
      retakeRecommended: true,
      reason: 'Heavy glare is washing out most of the frame. Try shading the lens or a different angle.',
      metrics,
    }
  }
  return { flag: null, retakeRecommended: false, metrics }
}

/**
 * Downscales for storage, builds a thumbnail, and assesses quality.
 *
 * Full-resolution roof photos are 4–12MB each and a rep may take forty. Keeping
 * originals on the phone fills storage and makes galleries stutter, so the
 * stored "full" image is capped on the long edge — still far more detail than a
 * proposal needs, at a fraction of the size.
 */
export async function processPhoto(file: Blob, maxEdge = 2048): Promise<ProcessedImage> {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const { canvas, ctx } = canvasOf(width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  const full = await toBlob(canvas, 0.85)

  // Quality is measured on a small downsample: the focus metric is scale
  // sensitive, and this keeps it fast and consistent across phone resolutions.
  const qw = 320
  const qh = Math.max(1, Math.round((height / width) * qw))
  const { canvas: qCanvas, ctx: qCtx } = canvasOf(qw, qh)
  qCtx.drawImage(bitmap, 0, 0, qw, qh)
  const quality = assessQuality(qCtx, qw, qh)
  qCanvas.width = 0

  const tw = 240
  const th = Math.max(1, Math.round((height / width) * tw))
  const { canvas: tCanvas, ctx: tCtx } = canvasOf(tw, th)
  tCtx.drawImage(bitmap, 0, 0, tw, th)
  const thumbnail = await toBlob(tCanvas, 0.7)
  tCanvas.width = 0

  bitmap.close()
  canvas.width = 0

  return { full, thumbnail, width, height, byteSize: full.size, quality }
}

/**
 * Best-effort location. Never blocks capture — a photo without GPS still counts.
 *
 * The `timeout` option is not sufficient on its own: per spec its clock does not
 * start until the permission prompt has been answered. A rep who ignores that
 * prompt, or a WebView that never surfaces it, leaves both callbacks unfired and
 * the promise pending forever — which stranded "Start inspection" on
 * "Getting location…" with no way out. Reproduced in a browser whose geolocation
 * permission was left unanswered. So we keep our own clock and always settle.
 */
export type LocationFailure =
  | 'unsupported'
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'unknown'

export type LocationResult =
  | { ok: true; position: GeolocationPosition }
  | { ok: false; reason: LocationFailure }

export function currentPositionResult(timeoutMs = 6000): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, reason: 'unsupported' })

    let settled = false
    const settle = (value: LocationResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(value)
    }
    const timer = window.setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutMs)

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => settle({ ok: true, position }),
        (error) => {
          const reason: LocationFailure =
            error.code === error.PERMISSION_DENIED
              ? 'permission_denied'
              : error.code === error.POSITION_UNAVAILABLE
                ? 'unavailable'
                : error.code === error.TIMEOUT
                  ? 'timeout'
                  : 'unknown'
          settle({ ok: false, reason })
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
      )
    } catch {
      settle({ ok: false, reason: 'unknown' })
    }
  })
}

export async function currentPosition(timeoutMs = 6000): Promise<GeolocationPosition | null> {
  const result = await currentPositionResult(timeoutMs)
  return result.ok ? result.position : null
}
