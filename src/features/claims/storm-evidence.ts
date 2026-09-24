/**
 * Storm evidence, tiered — and the sentence it is allowed to produce.
 *
 * The whole module turns on one distinction that roofing sales routinely
 * collapses: a hail report says where a person stood when they saw hail. It
 * does not say what fell on any particular roof. "1.75 inch hail hit this
 * house" is a claim about a house; the underlying record is a claim about a
 * spotter half a mile away. Repeating the second as the first is the most
 * common false statement in this industry and it is trivially disprovable in a
 * deposition.
 *
 * So evidence here always carries its distance, its source, and a sentence
 * written for it. The sentence is generated rather than left to a rep, because
 * the accurate phrasing is longer and less exciting than the inaccurate one and
 * will lose every time it is optional.
 *
 * TWO SOURCES THAT MUST NOT BE MIXED
 *
 *   Ground reports (NWS/SPC Local Storm Reports) are observations. A person saw
 *   hail and estimated its size, usually by comparing it to a coin. They are
 *   sparse, biased toward populated areas and roads, and their sizes are rough —
 *   but they are a human being saying "this happened here".
 *
 *   Radar estimates (NOAA MRMS MESH) are a model's inference of maximum
 *   expected hail size from reflectivity aloft. They cover everywhere on a
 *   grid, including the empty countryside no spotter was standing in — but
 *   nobody saw anything. MESH is known to run high in some regimes.
 *
 * They are different kinds of statement and averaging them produces a number
 * that is neither. They are reported separately, always, and the tier records
 * which of them exist rather than blending them into a score.
 */

export type StormTier =
  /** Both a nearby ground report and radar support at the property. */
  | 'A'
  /** A nearby ground report, no supporting radar. */
  | 'B'
  /** Radar indicates hail, nobody reported any. */
  | 'C'
  /** Something, but distant, small or at the edge of a grid. */
  | 'D'
  /** No material evidence. */
  | 'E'

export interface GroundReport {
  /** Inches, as the spotter estimated. */
  readonly hailInches: number
  /** Straight-line miles from the property. */
  readonly distanceMiles: number
  readonly occurredAt: string
  /** "NWS Local Storm Report", "SPC Storm Report". Never blank. */
  readonly source: string
}

export interface RadarEstimate {
  /** MESH maximum expected hail size, inches, over the grid cell. */
  readonly meshInches: number
  /** Whether the cell containing the property is the one being reported. */
  readonly overProperty: boolean
  readonly occurredAt: string
  readonly source: string
}

/**
 * How near a ground report has to be to say anything about this address.
 *
 * Two miles, and the number is a judgement rather than a measurement. Hail
 * swaths are commonly a mile or two wide and highly variable within that, so a
 * report five miles away tells you a storm was in the parish and nothing about
 * one roof. Anything beyond this is Tier D at best — present in the record,
 * never presented as being about the property.
 */
export const NEARBY_MILES = 2

/** Below this, hail does not damage asphalt shingles in any usual circumstance. */
export const MATERIAL_HAIL_INCHES = 1

export interface StormEvidence {
  readonly tier: StormTier
  /** The nearest qualifying ground report, if any. */
  readonly nearestReport: GroundReport | null
  readonly radar: RadarEstimate | null
  /**
   * What a rep may say out loud, written for them.
   *
   * Generated rather than composed at the call site, because the accurate
   * sentence is longer and duller than the inaccurate one and would lose.
   */
  readonly sentence: string
  /** Why this tier, in a line, for the "why?" drill-down. */
  readonly because: string
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function reportSentence(report: GroundReport): string {
  const size = round(report.hailInches).toFixed(2).replace(/0$/, '')
  const distance = report.distanceMiles < 0.1 ? 'less than 0.1' : round(report.distanceMiles, 1).toString()
  // Never "hit this house". Always where the observation was made.
  return `${size}" hail reported ${distance} miles away (${report.source}).`
}

function radarSentence(radar: RadarEstimate): string {
  const size = round(radar.meshInches).toFixed(2).replace(/0$/, '')
  const where = radar.overProperty ? 'over this property’s grid square' : 'nearby'
  // "Estimated" is load-bearing: MESH is a model output, not an observation.
  return `Radar estimated about ${size}" hail ${where} (${radar.source}).`
}

export function assessStorm(
  reports: readonly GroundReport[],
  radar: RadarEstimate | null,
): StormEvidence {
  const material = reports.filter((r) => r.hailInches >= MATERIAL_HAIL_INCHES)
  const nearby = material
    .filter((r) => r.distanceMiles <= NEARBY_MILES)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
  const nearest = nearby[0] ?? null

  const radarMaterial =
    radar !== null && radar.meshInches >= MATERIAL_HAIL_INCHES ? radar : null
  const radarHere = radarMaterial !== null && radarMaterial.overProperty

  if (nearest !== null && radarHere && radarMaterial !== null) {
    return {
      tier: 'A',
      nearestReport: nearest,
      radar: radarMaterial,
      // Both sentences, kept separate. Not merged into one averaged number.
      sentence: `${reportSentence(nearest)} ${radarSentence(radarMaterial)}`,
      because: 'A ground report nearby and radar over the property agree that hail fell here.',
    }
  }

  if (nearest !== null) {
    return {
      tier: 'B',
      nearestReport: nearest,
      radar: radarMaterial,
      sentence: reportSentence(nearest),
      because: 'Somebody reported hail near this address; radar does not add to it.',
    }
  }

  if (radarHere && radarMaterial !== null) {
    return {
      tier: 'C',
      nearestReport: null,
      radar: radarMaterial,
      sentence: `${radarSentence(radarMaterial)} No one reported hail near this address.`,
      because:
        'Radar indicates hail over this grid square, but nobody was there to see it — spotters are sparse.',
    }
  }

  const distant = material.sort((a, b) => a.distanceMiles - b.distanceMiles)[0] ?? null
  if (distant !== null || radarMaterial !== null) {
    return {
      tier: 'D',
      nearestReport: distant,
      radar: radarMaterial,
      sentence:
        distant !== null
          ? `${reportSentence(distant)} That is too far away to say anything about this roof.`
          : `${radarSentence(radarMaterial as RadarEstimate)} Not over this property.`,
      because: 'There was hail in the area, but not near enough to be about this address.',
    }
  }

  return {
    tier: 'E',
    nearestReport: null,
    radar: null,
    sentence: 'No material hail evidence for this address.',
    because: 'No report within reach and no radar signal above the damage threshold.',
  }
}
