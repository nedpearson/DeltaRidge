import type { RoutePoint } from './route-store'
import { segmentsOf } from './tracking'
import type { DoorEvent } from './route-stats'

/**
 * Things worth a manager's eye, phrased as questions rather than accusations.
 *
 * Every signal here is a shape in the data, and every shape has an innocent
 * explanation that is usually the true one. A phone dies. A basement eats the
 * signal. A rep works a cul-de-sac where six houses are inside one GPS radius
 * and records them in four minutes because that is how long it took. A system
 * that turns those into "suspected fraud" will be wrong most of the time, and
 * being wrong about this costs somebody their job.
 *
 * So the rules are strict:
 *
 *   - Nothing here outputs a verdict. Signals describe what was observed and
 *     say what a manager would need to check.
 *   - Nothing here is triggered by a single sample. Every threshold requires a
 *     pattern, because one noisy fix is weather, not behaviour.
 *   - The words "fraud", "lying", "cheating" and "falsified" do not appear, and
 *     must not be added later. If a manager concludes that, it should be their
 *     conclusion from evidence, not a label this file handed them.
 */

export type SignalCode =
  | 'large_gaps'
  | 'impossible_movement'
  | 'knocks_while_stationary'
  | 'rapid_knocks'
  | 'mostly_unverified'
  | 'open_route_no_movement'

export type SignalSeverity = 'note' | 'review'

export interface IntegritySignal {
  code: SignalCode
  severity: SignalSeverity
  /** What was observed. Facts only. */
  observed: string
  /** The ordinary explanation, stated first and always. */
  ordinary: string
  /** What a manager would actually have to do to find out. */
  check: string
}

export interface IntegrityRule {
  /** A gap longer than this is worth noting. */
  gapSeconds: number
  /** Needed before gaps are raised at all. */
  minGaps: number
  /** Faster than this between two fixes is not a vehicle on a residential street. */
  impossibleMps: number
  /** Knocks inside one stationary stretch before it is worth a look. */
  knocksWhileStationary: number
  /** Knocks per minute sustained over the window below. */
  rapidPerMinute: number
  rapidWindowKnocks: number
  /** Share of usable fixes that place the rep away from the door. */
  unverifiedShare: number
  /** Usable fixes required before that share is reported at all. */
  minUsableFixes: number
  /** Metres of recorded movement below which an open route looks idle. */
  idleMeters: number
  idleSeconds: number
}

export const DEFAULT_INTEGRITY_RULE: IntegrityRule = {
  gapSeconds: 900,
  minGaps: 3,
  // 40 m/s ≈ 90 mph. Below that is a highway, which is ordinary between
  // neighbourhoods and is not a signal.
  impossibleMps: 40,
  knocksWhileStationary: 6,
  rapidPerMinute: 2,
  rapidWindowKnocks: 8,
  unverifiedShare: 0.5,
  minUsableFixes: 12,
  idleMeters: 150,
  idleSeconds: 3600,
}

export function integritySignals(
  points: readonly RoutePoint[],
  events: readonly DoorEvent[],
  options: { routeOpen?: boolean; routeSeconds?: number; rule?: IntegrityRule } = {},
): IntegritySignal[] {
  const rule = options.rule ?? DEFAULT_INTEGRITY_RULE
  const out: IntegritySignal[] = []
  const segments = segmentsOf(points)
  const knocks = events.filter((e) => e.activityType === 'door_knock')

  // --- Gaps -----------------------------------------------------------------
  const longGaps = segments.filter((s) => s.gap && s.seconds >= rule.gapSeconds)
  if (longGaps.length >= rule.minGaps) {
    const total = Math.round(longGaps.reduce((t, s) => t + s.seconds, 0) / 60)
    out.push({
      code: 'large_gaps',
      severity: 'note',
      observed: `${longGaps.length} stretches with no fixes at all, ${total} minutes in total.`,
      ordinary: 'A phone that ran flat, lost signal indoors, or had location switched off between streets.',
      check: 'Ask how the day went. If the phone keeps dying, that is a hardware problem, not a performance one.',
    })
  }

  // --- Impossible movement --------------------------------------------------
  const impossible = segments.filter(
    (s) => !s.gap && s.seconds > 0 && s.meters / s.seconds > rule.impossibleMps,
  )
  if (impossible.length > 0) {
    out.push({
      code: 'impossible_movement',
      severity: 'note',
      observed: `${impossible.length} stretch${impossible.length === 1 ? '' : 'es'} where the recorded positions imply well over ${Math.round(rule.impossibleMps * 2.237)} mph.`,
      ordinary:
        'Almost always a bad fix. A phone re-acquiring GPS can report a position miles away for one sample.',
      check: 'Look at the trail either side. A single spike with a normal trail around it is noise.',
    })
  }

  // --- Knocks recorded while the phone did not move --------------------------
  // Counted against STATIONARY stretches, not against distance from the
  // property — that is what the per-knock GPS verdict already answers, and
  // double-counting it here would make one fact look like two problems.
  let stationaryKnockRun = 0
  for (const segment of segments) {
    if (segment.gap || segment.meters > 45 || segment.seconds < 120) continue
    const from = Date.parse(segment.from.recordedAt)
    const to = Date.parse(segment.to.recordedAt)
    const inside = knocks.filter((k) => {
      const at = Date.parse(k.at)
      return at >= from && at <= to
    })
    // Distinct addresses: three knocks at one door while standing there is one
    // rep being thorough.
    const doors = new Set(inside.map((k) => k.leadId)).size
    stationaryKnockRun = Math.max(stationaryKnockRun, doors)
  }
  if (stationaryKnockRun >= rule.knocksWhileStationary) {
    out.push({
      code: 'knocks_while_stationary',
      severity: 'review',
      observed: `${stationaryKnockRun} different doors recorded while the phone stayed inside one ${45} m radius.`,
      ordinary:
        'A tight cul-de-sac or an apartment block can genuinely put several doors inside one GPS radius.',
      check: 'Open the route and look at where those addresses actually are relative to the trail.',
    })
  }

  // --- Rapid knock pattern ---------------------------------------------------
  const times = knocks
    .map((k) => Date.parse(k.at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  if (times.length >= rule.rapidWindowKnocks) {
    let fastest = 0
    for (let i = 0; i + rule.rapidWindowKnocks - 1 < times.length; i += 1) {
      const span = ((times[i + rule.rapidWindowKnocks - 1] as number) - (times[i] as number)) / 60000
      if (span > 0) fastest = Math.max(fastest, rule.rapidWindowKnocks / span)
    }
    if (fastest >= rule.rapidPerMinute) {
      out.push({
        code: 'rapid_knocks',
        severity: 'review',
        observed: `${rule.rapidWindowKnocks} doors recorded at about ${fastest.toFixed(1)} a minute.`,
        ordinary:
          'Catching up on a street after the fact is common and is not the same as not knocking it.',
        check:
          'Ask whether outcomes were entered as they went or at the end of the street. If it is the latter, the timestamps are not the knock times and the GPS verdicts will read worse than the work was.',
      })
    }
  }

  // --- Mostly unverified -----------------------------------------------------
  const usable = knocks.filter((k) =>
    ['verified', 'probable', 'unverified'].includes(k.gpsVerification ?? ''),
  )
  const unverified = usable.filter((k) => k.gpsVerification === 'unverified')
  if (usable.length >= rule.minUsableFixes && unverified.length / usable.length >= rule.unverifiedShare) {
    out.push({
      code: 'mostly_unverified',
      severity: 'review',
      observed: `${unverified.length} of ${usable.length} door events had a fix that did not place the phone at that property.`,
      ordinary:
        'Outcomes entered from the truck at the end of a street produce exactly this pattern, and the work was still done.',
      check: 'Worth a conversation about when outcomes get entered before it is worth anything else.',
    })
  }

  // --- Route open, nothing happening ----------------------------------------
  const moved = segments.filter((s) => !s.gap).reduce((t, s) => t + s.meters, 0)
  if (
    options.routeOpen &&
    (options.routeSeconds ?? 0) >= rule.idleSeconds &&
    moved < rule.idleMeters &&
    knocks.length === 0
  ) {
    out.push({
      code: 'open_route_no_movement',
      severity: 'note',
      observed: `Route has been open ${Math.round((options.routeSeconds ?? 0) / 3600)}h with under ${rule.idleMeters} m of recorded movement and no doors.`,
      ordinary: 'Usually a route somebody forgot to end, which is a UI problem rather than a rep one.',
      check: 'A quick message. If routes are being left open overnight, the app should be closing them.',
    })
  }

  return out
}

/** Whether anything here warrants a manager actually opening the route. */
export function needsReview(signals: readonly IntegritySignal[]): boolean {
  return signals.some((s) => s.severity === 'review')
}
