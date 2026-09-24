import type { SourceRef } from '@/lib/provenance'

/**
 * A conclusion, and the records that establish it.
 *
 * `Sourced<T>` in lib/provenance already covers a single fact from a single
 * source: the assessor says the owner is Mayo, the permit says 2011. What it
 * cannot express is a CONCLUSION assembled from several facts — "strong storm
 * evidence" rests on a report, a distance, a radar estimate and a date, and no
 * one of them is the claim.
 *
 * Conclusions are where sales language goes wrong, because they are the
 * sentences a rep repeats and the only ones a homeowner remembers. So a
 * conclusion in this system cannot exist without its records attached.
 *
 * THE ENFORCEMENT
 *
 * `prove()` returns a discriminated union, and an empty record list produces
 * `established: false`. There is no way to construct a Proof that asserts
 * something and carries nothing. A caller that has no evidence gets an object
 * whose only renderable content is "not established" — so the screen shows the
 * absence rather than the claim, and the failure mode is a visibly empty panel
 * instead of a confident sentence with nothing behind it.
 *
 * That is the whole design. Everything else here is presentation.
 */

export interface ProofRecord {
  /** What this record is: "NWS Local Storm Report". */
  readonly label: string
  /** What it says, as a rep would read it aloud: "1.75\" hail, 0.8 miles away". */
  readonly detail: string
  readonly source: SourceRef
  /**
   * When the underlying observation happened — distinct from when we fetched it.
   *
   * An image retrieved this morning can have been captured in 2023, and the
   * difference is the whole question when somebody asks whether a photo shows
   * storm damage.
   */
  readonly observedAt?: string
  /** Where to go to see the record itself. Absent means it is not yet drillable. */
  readonly href?: string
}

export type Proof =
  | {
      readonly established: true
      /** The conclusion, in the words that will be shown. */
      readonly claim: string
      readonly records: readonly ProofRecord[]
      /**
       * What this evidence does NOT establish.
       *
       * Required, and required to be non-empty in practice for anything about a
       * roof's condition, because the most persuasive thing a contractor can do
       * is name the limits of their own case before the homeowner finds them.
       */
      readonly gaps: readonly string[]
    }
  | {
      readonly established: false
      readonly claim: string
      /** Why there is nothing to show. Rendered instead of the claim. */
      readonly because: string
    }

/**
 * Build a proof, or refuse to.
 *
 * `records` being empty is not an error to throw — it is an ordinary state that
 * the UI must be able to render, because "we have not established this yet" is
 * a true and useful thing to show a rep.
 */
export function prove(
  claim: string,
  records: readonly ProofRecord[],
  gaps: readonly string[] = [],
): Proof {
  if (records.length === 0) {
    return {
      established: false,
      claim,
      because: 'Nothing on file establishes this yet.',
    }
  }
  return { established: true, claim, records, gaps }
}

/** An explicit refusal, when the reason is more specific than "nothing on file". */
export function unproven(claim: string, because: string): Proof {
  return { established: false, claim, because }
}

/**
 * The line a screen shows when it has room for one line.
 *
 * Never the bare claim. An unestablished conclusion renders as its absence,
 * which is the point of the whole module: the compact form cannot be used to
 * smuggle an unsupported assertion onto a screen.
 */
export function headline(proof: Proof): string {
  if (!proof.established) return `${proof.claim} — not established`
  const count = proof.records.length
  return `${proof.claim} (${count} ${count === 1 ? 'record' : 'records'})`
}

/**
 * Oldest observation in the proof, which is how stale the case actually is.
 *
 * A conclusion is only as current as its oldest load-bearing record, so this
 * reports the oldest rather than the newest — the flattering number is the one
 * nobody should be quoting.
 */
export function oldestObservation(proof: Proof): string | null {
  if (!proof.established) return null
  const dates = proof.records
    .map((r) => r.observedAt)
    .filter((d): d is string => typeof d === 'string')
    .filter((d) => !Number.isNaN(new Date(d).getTime()))
    .sort()
  return dates[0] ?? null
}

/** Whether every record can be opened. A proof nobody can check is a slogan. */
export function fullyDrillable(proof: Proof): boolean {
  if (!proof.established) return false
  return proof.records.every((record) => typeof record.href === 'string' && record.href !== '')
}
