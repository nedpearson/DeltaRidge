import type { HailObservation, StormEvent } from '@/integrations/storm'
import { countByYear, type ResolvedWindow } from './window'

/**
 * What the storm data actually is, said plainly.
 *
 * The page used to show "26 hail reports" and nothing else, which cannot
 * answer the only question a rep has when the list looks wrong: is this all
 * the hail there was, or is the product not looking properly?
 *
 * So this reports the sources SEPARATELY and names the ones that are not
 * running. A single blended count that silently omits radar-estimated hail
 * reads as completeness and is the thing to avoid.
 */

export type HailSourceKind =
  /**
   * 'official_report' — a human reported hail on the ground and the NWS logged it.
   * 'radar_estimate'  — radar estimated hail aloft. Not the same claim.
   */
  | HailObservation
  /** A rep saw it themselves. */
  | 'field_confirmed'

/** An event with no recorded observation predates radar and is a ground report. */
export function observationOf(event: StormEvent): HailObservation {
  return event.observation ?? 'official_report'
}

export const HAIL_SOURCE_LABEL: Record<HailSourceKind, string> = {
  official_report: 'Official hail report',
  radar_estimate: 'Radar-estimated hail',
  field_confirmed: 'Field-confirmed',
}

export type SourceStatus =
  | {
      readonly kind: 'live'
      readonly newestAt: string | null
      readonly count: number
      /** What this count is a count OF, when that is not obvious. */
      readonly note?: string
    }
  | { readonly kind: 'not_configured'; readonly why: string }
  | { readonly kind: 'failed'; readonly why: string }

export interface StormCoverage {
  readonly window: ResolvedWindow
  readonly official: SourceStatus
  readonly radar: SourceStatus
  readonly totalEvents: number
  readonly currentYearEvents: number
  readonly oldestAt: string | null
  readonly newestAt: string | null
  readonly byYear: readonly { readonly year: string; readonly count: number }[]
}

/**
 * Kept for workspaces where radar is unavailable or deliberately disabled.
 * Delta Ridge can use either NOAA MRMS MESH from the server-side GRIB2 worker
 * or NOAA NCEI SWDI NEXRAD hail detections from the browser.
 */
export const RADAR_NOT_CONFIGURED: SourceStatus = {
  kind: 'not_configured',
  why:
    'Radar-estimated hail is not configured for this workspace. Only official ground reports are being used.',
}

/** Radar deliberately switched off for this workspace. Not a failure. */
export const RADAR_OFF: SourceStatus = {
  kind: 'not_configured',
  why:
    'Radar-estimated hail is turned off for this workspace, so only official ground ' +
    'reports are being used. Configure VITE_RADAR_HAIL=mrms or swdi to turn it on.',
}

export function radarFailed(why: string): SourceStatus {
  return { kind: 'failed', why }
}

export function buildCoverage(
  window: ResolvedWindow,
  officialEvents: readonly StormEvent[],
  radarEvents: readonly StormEvent[],
  officialFailed: boolean,
  radar: SourceStatus = RADAR_NOT_CONFIGURED,
): StormCoverage {
  const all = [...officialEvents, ...radarEvents]
  const times = all.map((e) => e.occurredAt).sort()
  const officialTimes = officialEvents.map((e) => e.occurredAt).sort()
  const oldestAt = times[0] ?? null
  const newestAt = times[times.length - 1] ?? null
  const currentYear = String(new Date(window.to).getFullYear())

  return {
    window,
    official: officialFailed
      ? {
          kind: 'failed',
          why: 'The official storm report feed could not be reached on this run.',
        }
      : {
          kind: 'live',
          // Deliberately the newest OFFICIAL report, not the newest of either.
          // This line sits under "Official ground reports" and would otherwise
          // date a ground report to a day only radar saw anything.
          newestAt: officialTimes[officialTimes.length - 1] ?? null,
          count: officialEvents.length,
        },
    radar,
    totalEvents: all.length,
    currentYearEvents: all.filter((e) => e.occurredAt.startsWith(currentYear)).length,
    oldestAt,
    newestAt,
    byYear: countByYear(times),
  }
}

/**
 * The radar row, once it has actually run.
 *
 * Carries the size floor in the sentence because the floor is the whole reason
 * the number is what it is: MEHS over-predicts, and a count taken at 1.0" is a
 * different claim from the same count taken at 1.25".
 */
export function radarLive(
  events: readonly StormEvent[],
  minInches: number,
  corroborated: number,
  source: 'mrms' | 'swdi' = 'swdi',
): SourceStatus {
  const times = events.map((e) => e.occurredAt).sort()
  const floor = `${minInches}"`
  const sourceText =
    source === 'mrms'
      ? 'NOAA MRMS MESH Max 30-minute grid cells'
      : 'NEXRAD Level-III hail detection (NOAA NCEI SWDI), one reading per place per day'
  const limitation =
    source === 'mrms'
      ? 'MESH is a radar-derived estimate of maximum hail size; it is not a ground observation.'
      : 'Radar estimates hail aloft and can over-predict it.'

  return {
    kind: 'live',
    newestAt: times[times.length - 1] ?? null,
    count: events.length,
    note:
      `${sourceText} at ${floor} or larger. ${corroborated} of ${events.length} have a ground report ` +
      `within 10 miles the same day. ${limitation} Radar-only records are labelled that way on the lead.`,
  }
}

/** The sentence the screen shows when the window is empty. */
export function emptyWindowExplanation(coverage: StormCoverage): string {
  if (coverage.official.kind === 'failed') {
    return 'The storm feed could not be reached, so this is not a statement about the weather.'
  }
  if (coverage.radar.kind === 'not_configured') {
    return (
      `No official hail reports in ${coverage.window.label.toLowerCase()} for this area. ` +
      'Radar-estimated hail is not configured, so hail that fell without anyone reporting it ' +
      'would not appear here.'
    )
  }
  if (coverage.radar.kind === 'failed') {
    return (
      `No official hail reports in ${coverage.window.label.toLowerCase()} for this area, and ` +
      'the radar hail service could not be reached on this run, so this is not the full picture.'
    )
  }
  return (
    `No qualifying hail in ${coverage.window.label.toLowerCase()} for this area — ` +
    'neither a ground report nor a radar estimate above the size floor.'
  )
}
