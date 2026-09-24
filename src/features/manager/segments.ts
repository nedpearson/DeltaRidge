import { bandLabel, bandOf, isDecided, isWon } from './metrics'
import type { AssignedLead } from './performance'

/**
 * Where a rep is strong, and where they are not.
 *
 * The honest scope of this file is narrower than it looks. "Insurance hail
 * versus retail" is the split every roofing manager actually wants, and this
 * system cannot make it: nothing in the schema records whether a door was
 * worked as a claim or a cash job. Inventing that split from the score, or from
 * whether a storm happened to be in range, would produce a confident answer to
 * a question the data has not been asked.
 *
 * So the segments here are the ones that genuinely exist — the frozen score
 * band and the neighbourhood — and `MISSING_SEGMENTS` names the ones that do
 * not, so the gap is visible on the screen rather than quietly absent.
 */

export const MISSING_SEGMENTS = [
  {
    name: 'Insurance claim against retail',
    needs: 'a field on the lead recording how the job is being paid for. Nothing records it today.',
  },
  {
    name: 'Cold door against warm callback',
    needs: 'the origin of the lead. Every lead in the system today came from the door list.',
  },
  {
    name: 'Campaign',
    needs: 'a campaign id on the assignment. Assignments carry a reason in words, not a campaign.',
  },
] as const

export interface SegmentResult {
  key: string
  label: string
  assigned: number
  decided: number
  won: number
  /** Null below the floor. A rep with two doors in a band has no rate there. */
  rate: number | null
  unavailable: string | null
}

/** Below this many decided doors, a segment says nothing about anybody. */
export const MIN_DECIDED_PER_SEGMENT = 12

export function segmentBy(
  leads: readonly AssignedLead[],
  segmenter: (lead: AssignedLead) => { key: string; label: string } | null,
  minimum = MIN_DECIDED_PER_SEGMENT,
): SegmentResult[] {
  const cells = new Map<string, SegmentResult>()

  for (const lead of leads) {
    const segment = segmenter(lead)
    if (!segment) continue
    const cell =
      cells.get(segment.key) ??
      ({
        key: segment.key,
        label: segment.label,
        assigned: 0,
        decided: 0,
        won: 0,
        rate: null,
        unavailable: null,
      } satisfies SegmentResult)

    cell.assigned += 1
    if (isDecided(lead.status)) {
      cell.decided += 1
      if (isWon(lead.status)) cell.won += 1
    }
    cells.set(segment.key, cell)
  }

  return [...cells.values()]
    .map((cell) => ({
      ...cell,
      rate: cell.decided >= minimum ? cell.won / cell.decided : null,
      unavailable:
        cell.decided >= minimum
          ? null
          : `${cell.decided} decided of ${cell.assigned} assigned. Needs ${minimum} before it says anything.`,
    }))
    .sort((a, b) => b.assigned - a.assigned)
}

export function byScoreBand(leads: readonly AssignedLead[]): SegmentResult[] {
  return segmentBy(leads, (lead) => {
    const band = bandOf(lead.scoreAtAssignment)
    return { key: `band-${band}`, label: `Score ${bandLabel(band)}` }
  })
}

export function bySubdivision(leads: readonly AssignedLead[]): SegmentResult[] {
  return segmentBy(leads, (lead) =>
    lead.subdivision ? { key: lead.subdivision, label: lead.subdivision } : null,
  )
}

/**
 * The strongest and weakest segments, when there are enough of either to say.
 *
 * Returns nothing rather than a best-of-two. "Strongest: insurance hail" from a
 * rep with exactly one qualifying segment is a sentence that reads like a
 * finding and contains none.
 */
export function standout(segments: readonly SegmentResult[]): {
  strongest: SegmentResult | null
  weakest: SegmentResult | null
} {
  const usable = segments.filter((s) => s.rate !== null).sort((a, b) => (b.rate as number) - (a.rate as number))
  if (usable.length < 2) return { strongest: null, weakest: null }
  return {
    strongest: usable[0] ?? null,
    weakest: usable[usable.length - 1] ?? null,
  }
}
