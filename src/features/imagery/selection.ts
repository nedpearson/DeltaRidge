import type { FreshnessBand, ImageryCapture, StormPair } from './types'

function timeOf(capture: ImageryCapture): number | null {
  const value = capture.capturedUntil ?? capture.capturedFrom
  if (value === null) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

export function ageDays(capture: ImageryCapture, now = Date.now()): number | null {
  const time = timeOf(capture)
  return time === null ? null : Math.max(0, Math.floor((now - time) / 86_400_000))
}

export function freshnessBand(capture: ImageryCapture, now = Date.now()): FreshnessBand {
  const days = ageDays(capture, now)
  if (days === null) return 'unknown'
  if (days < 1) return 'under_24_hours'
  if (days <= 7) return 'one_to_seven_days'
  if (days <= 30) return 'eight_to_thirty_days'
  if (days <= 90) return 'thirty_one_to_ninety_days'
  return 'older'
}

export function freshnessLabel(capture: ImageryCapture, now = Date.now()): string {
  const days = ageDays(capture, now)
  if (days === null) return 'Capture date unavailable'
  if (days === 0) return 'Captured within 24 hours'
  if (days === 1) return 'Captured 1 day ago'
  return `Captured ${days} days ago`
}

/** Best means newest capture first, then finer resolution, then ortho. */
export function rankCaptures(captures: readonly ImageryCapture[]): ImageryCapture[] {
  return [...captures].sort((a, b) => {
    const date = (timeOf(b) ?? -Infinity) - (timeOf(a) ?? -Infinity)
    if (date !== 0) return date
    const gsd = (a.gsdMetres ?? Infinity) - (b.gsdMetres ?? Infinity)
    if (gsd !== 0) return gsd
    return Number(b.view === 'ortho') - Number(a.view === 'ortho')
  })
}

export function withinDays(
  captures: readonly ImageryCapture[],
  days: number | null,
  now = Date.now(),
): ImageryCapture[] {
  if (days === null) return rankCaptures(captures)
  return rankCaptures(captures.filter((capture) => {
    const age = ageDays(capture, now)
    return age !== null && age <= days
  }))
}

export function pairAroundStorm(
  captures: readonly ImageryCapture[],
  occurredAt: string,
): StormPair {
  const storm = Date.parse(occurredAt)
  if (Number.isNaN(storm)) return { before: null, after: null }
  const dated = captures
    .map((capture) => ({ capture, time: timeOf(capture) }))
    .filter((row): row is { capture: ImageryCapture; time: number } => row.time !== null)
  const before = dated
    .filter((row) => row.time < storm)
    .sort((a, b) => b.time - a.time)[0]?.capture ?? null
  const after = dated
    .filter((row) => row.time >= storm)
    .sort((a, b) => a.time - b.time)[0]?.capture ?? null
  return { before, after }
}

export function resolutionLabel(gsdMetres: number | null): string {
  if (gsdMetres === null) return 'Resolution not supplied'
  const inches = gsdMetres / 0.0254
  return `${inches < 1 ? inches.toFixed(2) : inches.toFixed(1)}-inch GSD`
}
