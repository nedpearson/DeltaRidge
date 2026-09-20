import type { StormEvent } from '@/integrations/storm'
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
  /** A human reported hail on the ground and the NWS logged it. */
  | 'official_report'
  /** Radar estimated hail aloft. Not the same claim. */
  | 'radar_estimate'
  /** A rep saw it themselves. */
  | 'field_confirmed'

export const HAIL_SOURCE_LABEL: Record<HailSourceKind, string> = {
  official_report: 'Official hail report',
  radar_estimate: 'Radar-estimated hail',
  field_confirmed: 'Field-confirmed',
}

export type SourceStatus =
  | { readonly kind: 'live'; readonly newestAt: string | null; readonly count: number }
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
 * MRMS / MESH is not wired up, and saying so is the point.
 *
 * It cannot be: MRMS publishes GRIB2 grids on S3, which a browser cannot
 * decode, and this application has no server. Adding it means a server-side or
 * edge job that reads the grid, extracts MESH above a threshold and writes
 * events. Until that exists the honest thing is a named gap rather than a
 * blended number that looks complete.
 */
export const RADAR_NOT_CONFIGURED: SourceStatus = {
  kind: 'not_configured',
  why:
    'Live radar-estimated hail (MRMS/MESH) is not configured. It needs server-side ' +
    'processing of NOAA GRIB2 grids, which a browser cannot do. Only official ' +
    'ground reports are being used.',
}

export function buildCoverage(
  window: ResolvedWindow,
  events: readonly StormEvent[],
  officialFailed: boolean,
  radar: SourceStatus = RADAR_NOT_CONFIGURED,
): StormCoverage {
  const times = events.map((e) => e.occurredAt).sort()
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
      : { kind: 'live', newestAt, count: events.length },
    radar,
    totalEvents: events.length,
    currentYearEvents: events.filter((e) => e.occurredAt.startsWith(currentYear)).length,
    oldestAt,
    newestAt,
    byYear: countByYear(times),
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
  return `No qualifying hail in ${coverage.window.label.toLowerCase()} for this area.`
}
