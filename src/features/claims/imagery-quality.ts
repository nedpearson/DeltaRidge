/**
 * What a picture is good enough to prove.
 *
 * Aerial imagery is the cheapest evidence in this business and the easiest to
 * overstate. A crisp two-inch orthomosaic looks authoritative on a phone, and a
 * rep will point at it and say "you can see the damage right there" — about a
 * defect class that is physically smaller than one pixel.
 *
 * ---------------------------------------------------------------------------
 * THE ARITHMETIC, AND WHY IT HAS TO BE OURS
 * ---------------------------------------------------------------------------
 *
 * EagleView publishes its resolutions: 6-inch standard, 3-inch, 2-inch on the
 * Reveal annual refresh, and sub-1-inch (as fine as 0.75") on their best
 * product. Their drone guide separately claims up to 1 mm/pixel, which is a
 * 20-25x linear improvement and tells you what they think aerial cannot do.
 *
 * What EagleView does NOT publish is any statement of what aerial imagery
 * cannot confirm. There is no citable vendor admission that 2-inch imagery
 * cannot show hail bruising. So the limitation below is OURS, defended on pixel
 * size, and it must never be attributed to EagleView — a disclaimer sourced to
 * a vendor who never said it is worse than no disclaimer.
 *
 * The sizes are physical facts about the defects:
 *
 *   A hail bruise on asphalt is roughly 0.25-1.5 inches across, and the thing
 *   that identifies it is a texture change and a soft spot, not an outline.
 *   Granule loss shows as a subtle tonal shift over a small patch. Mat fracture
 *   is invisible from above at any altitude.
 *
 * A feature needs several pixels across it to be identifiable rather than
 * merely present, so the thresholds below demand the pixel be a fraction of the
 * defect. A missing shingle is 12 inches across and survives this easily. A
 * hail bruise does not survive it at any aerial resolution EagleView sells.
 */

/** What somebody wants to conclude from the picture. */
export type Finding =
  /** Whole shingles gone, tarps, exposed deck, tree through the roof. */
  | 'gross_damage'
  /** Patches, mismatched shingles, prior repairs. */
  | 'repair_history'
  /** Overall wear, staining, ponding. */
  | 'general_condition'
  /** Hail bruising, granule loss, soft metal dents, mat fracture. */
  | 'hail_impact'

/**
 * Metres per pixel at which each finding stops being readable.
 *
 * Derived from defect size, not from marketing copy. `hail_impact` is set to a
 * value no aerial product reaches on purpose: EagleView's finest published
 * aerial is 0.75 inch (0.019 m), and the threshold here is 0.005 m — about
 * 1/5 inch — which is drone territory. That is the honest answer, and making it
 * reachable by tightening the number would be lying with arithmetic.
 */
const MAX_GSD_METRES: Record<Finding, number> = {
  gross_damage: 0.15,      // 6 inch: a missing shingle is a foot across
  repair_history: 0.08,    // ~3 inch: a patch is a few shingles
  general_condition: 0.15,
  hail_impact: 0.005,      // ~1/5 inch: below every aerial product sold
}

export interface ImageryFacts {
  /** Ground sample distance in metres, as the provider reports it. */
  readonly gsdMetres: number | null
  /**
   * Capture date. For a composite this is the START of the window.
   *
   * EagleView's own spec warns that `shot_time` "cannot be relied upon for
   * composite images which are created from multiple source images taken at
   * different times" — so a composite gets a window, never a date.
   */
  readonly capturedFrom: string | null
  readonly capturedUntil: string | null
  /** True when the image is stitched from flights on different days. */
  readonly composite: boolean
  readonly source: string
  /** Fraction of the roof hidden by trees or shadow, if known. */
  readonly obstructedFraction: number | null
}

export type QualityVerdict =
  | { readonly ok: true; readonly caveat: string | null }
  | { readonly ok: false; readonly reason: string; readonly instead: string }

/** What to print under the picture. Never "live", never "current". */
export function captureLabel(facts: ImageryFacts): string {
  if (facts.capturedFrom === null) {
    // No date means no claim about recency. Not "current", not "latest".
    return `${facts.source} — capture date not supplied`
  }
  const from = new Date(facts.capturedFrom)
  if (Number.isNaN(from.getTime())) return `${facts.source} — capture date unreadable`

  /*
   * Formatted in UTC, deliberately.
   *
   * Providers give capture times as UTC instants. Rendering them in the
   * viewer's zone moved every date one day earlier for anyone west of
   * Greenwich — so a picture captured 10 April displayed as 9 April on every
   * phone in Louisiana. That is small, precise, and exactly the sort of error
   * that matters here, because these dates are used to argue whether an image
   * pre-dates or post-dates a storm.
   */
  const day = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })

  if (facts.composite) {
    const until = facts.capturedUntil === null ? null : new Date(facts.capturedUntil)
    const end = until !== null && !Number.isNaN(until.getTime()) ? until : from
    /*
     * A window, because a composite is stitched from several flights and no
     * single date is true of the whole picture. Presenting the start date alone
     * would be the sort of small precise lie that survives until somebody
     * checks it in a deposition.
     */
    return `${facts.source} — captured between ${day(from)} and ${day(end)}`
  }
  return `${facts.source} — captured ${day(from)}`
}

export function assessImagery(
  facts: ImageryFacts,
  finding: Finding,
  storm: { readonly occurredAt: string | null },
): QualityVerdict {
  if (facts.gsdMetres === null) {
    return {
      ok: false,
      reason: 'The provider did not say how detailed this image is.',
      instead: 'Treat it as illustrative only until the resolution is known.',
    }
  }

  const limit = MAX_GSD_METRES[finding]
  if (facts.gsdMetres > limit) {
    const inches = (facts.gsdMetres / 0.0254).toFixed(1)
    return {
      ok: false,
      reason:
        finding === 'hail_impact'
          ? `Each pixel covers about ${inches} inches of roof. A hail bruise is smaller than that, so this image cannot show one either way.`
          : `Each pixel covers about ${inches} inches of roof, which is too coarse for that.`,
      instead:
        finding === 'hail_impact'
          ? 'A close-range drone inspection, or somebody on the roof.'
          : 'Finer imagery, or a closer inspection.',
    }
  }

  if (facts.capturedFrom === null) {
    return {
      ok: false,
      reason: 'This image has no capture date, so it cannot be placed before or after the storm.',
      instead: 'Imagery with a known capture date.',
    }
  }

  if (storm.occurredAt !== null) {
    // The comparison that decides whether a picture is evidence of anything.
    // For a composite, the END of the window is the earliest moment the whole
    // picture can be said to post-date.
    const latest = new Date(facts.capturedUntil ?? facts.capturedFrom)
    const stormAt = new Date(storm.occurredAt)
    if (!Number.isNaN(latest.getTime()) && !Number.isNaN(stormAt.getTime()) && latest < stormAt) {
      return {
        ok: false,
        reason: 'This image was taken before the storm, so it cannot show storm damage.',
        instead: 'It is useful as the "before" half of a comparison.',
      }
    }
  }

  if (facts.obstructedFraction !== null && facts.obstructedFraction > 0.3) {
    const percent = Math.round(facts.obstructedFraction * 100)
    return {
      ok: false,
      reason: `About ${percent}% of the roof is hidden by trees or shadow.`,
      instead: 'A different angle, or a closer inspection.',
    }
  }

  const caveats: string[] = []
  if (facts.composite) {
    caveats.push('stitched from flights on different days, so the date is a range')
  }
  if (facts.obstructedFraction !== null && facts.obstructedFraction > 0.1) {
    caveats.push(`about ${Math.round(facts.obstructedFraction * 100)}% of the roof is obscured`)
  }
  return { ok: true, caveat: caveats.length === 0 ? null : caveats.join('; ') }
}
