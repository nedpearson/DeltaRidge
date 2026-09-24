/**
 * Whether an integration is actually working.
 *
 * The failure this exists to prevent is a green dot next to something broken.
 * That is not a hypothetical: the usual way a health screen gets built is to
 * check whether a credential is configured, which answers a question nobody
 * asked. A token can be present and expired, a webhook URL can be correct and
 * pointed at a Zap somebody paused, and an API can answer 200 with nothing in
 * it. All three show green on a screen that checks configuration.
 *
 * So every state below is derived from OBSERVED TRAFFIC — something was sent or
 * received, and it either worked or it did not. There is no input to these
 * functions representing "a key exists", because that fact is not evidence of
 * anything and its presence in the model would eventually be used.
 *
 * The distinction that does most of the work is between DOWN and NEVER USED.
 * An integration nobody has exercised is not healthy and is not broken; it is
 * unproven, and saying so is the honest answer on the day somebody wires up a
 * Zap and wants to know whether it took.
 */

export type HealthState =
  /** No credential, no traffic, nothing set up. Not a fault. */
  | 'not_configured'
  /** Configured, but nothing has ever gone through. Unproven, not healthy. */
  | 'never_used'
  /** Recent traffic, and it worked. */
  | 'healthy'
  /** Working sometimes. Something is wrong but it is not dead. */
  | 'degraded'
  /** Recent traffic, all of it failing. */
  | 'down'
  /** It used to work and has gone quiet for longer than it should. */
  | 'stale'

export interface TrafficWindow {
  /** Whether anything is configured at all. */
  readonly configured: boolean
  readonly successes: number
  readonly failures: number
  readonly lastSuccessAt: string | null
  readonly lastFailureAt: string | null
  /**
   * How long this integration may be silent before silence is itself a signal.
   *
   * Null for anything event-driven where quiet is normal — a Roofr proposal
   * webhook is silent for a week whenever nobody sends a proposal, and calling
   * that "down" would train everybody to ignore the screen.
   */
  readonly expectedWithinHours: number | null
}

export interface Health {
  readonly state: HealthState
  /** One sentence a person can act on. Never "check the logs". */
  readonly summary: string
  readonly successes: number
  readonly failures: number
  readonly lastSuccessAt: string | null
  readonly lastFailureAt: string | null
}

/** Below this success rate, something is wrong even though traffic is flowing. */
const DEGRADED_BELOW = 0.9

function hoursSince(iso: string | null, now: number): number | null {
  if (iso === null) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return (now - then) / 3_600_000
}

function ago(hours: number): string {
  if (hours < 1) return 'in the last hour'
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

export function assessHealth(window: TrafficWindow, now: number = Date.now()): Health {
  const base = {
    successes: window.successes,
    failures: window.failures,
    lastSuccessAt: window.lastSuccessAt,
    lastFailureAt: window.lastFailureAt,
  }

  if (!window.configured) {
    return { ...base, state: 'not_configured', summary: 'Not set up.' }
  }

  const total = window.successes + window.failures
  if (total === 0) {
    /*
     * The important one. A configured integration with no traffic is the state
     * somebody is in the moment after they finish wiring up a Zap, and telling
     * them it is "connected" would be a lie they only discover a fortnight
     * later when they notice no leads arrived.
     */
    return {
      ...base,
      state: 'never_used',
      summary: 'Set up, but nothing has gone through it yet. Send one to prove it works.',
    }
  }

  if (window.successes === 0) {
    const when = hoursSince(window.lastFailureAt, now)
    return {
      ...base,
      state: 'down',
      summary:
        when === null
          ? `${window.failures} attempts, none of them worked.`
          : `${window.failures} attempts, none worked. Last tried ${ago(when)}.`,
    }
  }

  const rate = window.successes / total
  if (rate < DEGRADED_BELOW) {
    return {
      ...base,
      state: 'degraded',
      summary: `${window.failures} of ${total} failed. It is working, but not reliably.`,
    }
  }

  const quietFor = hoursSince(window.lastSuccessAt, now)
  if (
    window.expectedWithinHours !== null &&
    quietFor !== null &&
    quietFor > window.expectedWithinHours
  ) {
    /*
     * Silence only counts where silence is abnormal. An integration that is
     * quiet because nobody sent a proposal this week is not broken, and the
     * expectedWithinHours being null for those is what keeps this screen worth
     * looking at.
     */
    return {
      ...base,
      state: 'stale',
      summary: `Last worked ${ago(quietFor)}, which is longer than expected. Worth a check.`,
    }
  }

  return {
    ...base,
    state: 'healthy',
    summary:
      quietFor === null
        ? `${window.successes} succeeded.`
        : `Last worked ${ago(quietFor)}. ${window.failures > 0 ? `${window.failures} failed recently.` : ''}`.trim(),
  }
}

/** Ordered worst-first, because a health screen is read for its problems. */
const SEVERITY: Record<HealthState, number> = {
  down: 0,
  degraded: 1,
  stale: 2,
  never_used: 3,
  healthy: 4,
  not_configured: 5,
}

export function worstFirst<T extends { readonly health: Health }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => SEVERITY[a.health.state] - SEVERITY[b.health.state])
}

/** Whether anything here needs a person today. */
export function needsAttention(items: readonly { readonly health: Health }[]): number {
  return items.filter((i) => ['down', 'degraded', 'stale'].includes(i.health.state)).length
}
