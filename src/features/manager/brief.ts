import type { DailyRollup, ManagerException } from './daily'

/**
 * The end-of-day brief, and the thing that stops it lying.
 *
 * Spec 29 asks for an AI-written manager summary and then states the rule that
 * makes it usable: every number must come from real data, and the model must
 * not invent counts. That rule is worth nothing as an instruction in a prompt.
 * A language model asked to summarise "24 appointments" will, often enough to
 * matter, write "roughly 25" or "over two dozen" or add a figure nobody gave
 * it, and the manager reading it has no way to tell which numbers were real.
 *
 * So the rule is enforced here instead of requested there:
 *
 *   1. Every figure is computed first, deterministically (daily.ts).
 *   2. Those figures are the ONLY numbers allowed to appear in the brief.
 *   3. Any candidate text is checked against them before a person sees it,
 *      and text containing a number that was not supplied is rejected.
 *
 * `writeBrief` produces the deterministic version, which needs no model and is
 * what ships today - no AI provider is configured in this app. When one is,
 * `verifyBrief` is the gate its output goes through, and the deterministic
 * brief is the fallback when it fails. The order matters: the brief is never
 * the source of a number, only a rephrasing of one.
 */

export interface BriefFacts {
  readonly numbers: ReadonlySet<number>
  readonly rollup: DailyRollup
  readonly exceptions: readonly ManagerException[]
}

/**
 * Every number a brief about this day is permitted to contain.
 *
 * Built from the rollup and the exception counts, nothing else. If a figure is
 * not in here, no sentence may state it.
 */
export function factsFor(
  rollup: DailyRollup,
  exceptionList: readonly ManagerException[],
): BriefFacts {
  const numbers = new Set<number>([
    rollup.repsOut,
    rollup.routes,
    rollup.routesStillOpen,
    rollup.doors,
    rollup.verified,
    rollup.conversations,
    rollup.appointments,
    rollup.inspections,
  ])
  for (const e of exceptionList) numbers.add(e.count)
  return { numbers, rollup, exceptions: exceptionList }
}

/**
 * Pulls every number out of a piece of prose.
 *
 * Deliberately crude and deliberately greedy: it matches digits wherever they
 * appear, including inside "1,240" and "3.5". A guard that missed a format
 * would be worse than none, because it would license exactly the sentence it
 * failed to read.
 */
export function numbersIn(text: string): number[] {
  const found: number[] = []
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''))
    if (Number.isFinite(value)) found.push(value)
  }
  return found
}

export interface BriefCheck {
  readonly ok: boolean
  /** Numbers in the text that no computed figure supports. */
  readonly unsupported: number[]
}

/**
 * Checks a candidate brief against the facts it was given.
 *
 * Years and ordinary date parts are not exempted, and that is intentional: a
 * brief has no business printing a year, and allowing a whitelist is how the
 * first unchecked number gets in.
 */
export function verifyBrief(text: string, facts: BriefFacts): BriefCheck {
  const unsupported = numbersIn(text).filter((n) => !facts.numbers.has(n))
  return { ok: unsupported.length === 0, unsupported }
}

// ---------------------------------------------------------------------------
// The deterministic brief
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Writes the day up from the computed figures alone.
 *
 * No model, no key, no network. It is duller than a generated paragraph and it
 * cannot be wrong, which for a number a manager may act on is the better
 * trade. It is also the fallback whenever a generated brief fails the guard.
 */
export function writeBrief(facts: BriefFacts): string[] {
  const r = facts.rollup
  const lines: string[] = []

  if (r.routes === 0) {
    lines.push('No routes were run in this window.')
  } else {
    lines.push(
      `${plural(r.repsOut, 'rep')} worked ${plural(r.routes, 'route')}, ` +
        `knocking ${plural(r.doors, 'door')}.`,
    )
    lines.push(
      `${plural(r.conversations, 'conversation')}, ` +
        `${plural(r.appointments, 'appointment')} and ` +
        `${plural(r.inspections, 'inspection')} came out of it. ` +
        `${r.verified} of those knocks were matched to a GPS fix.`,
    )
    if (r.routesStillOpen > 0) {
      lines.push(
        `${plural(r.routesStillOpen, 'route')} still open, so these figures are not final.`,
      )
    }
  }

  if (facts.exceptions.length > 0) {
    lines.push(
      `${plural(facts.exceptions.length, 'thing')} worth a look, listed below. ` +
        'None of them is a conclusion about anybody.',
    )
  }

  if (r.unmeasured.length > 0) {
    lines.push(
      `Not counted here: ${r.unmeasured.join(', ')}. ` +
        'Left out rather than shown as zero, because there is no source for them on this screen.',
    )
  }

  return lines
}
