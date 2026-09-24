import type { Rate } from './performance'

/**
 * Whether somebody is getting better.
 *
 * A trend is the easiest thing in this system to report dishonestly. Two
 * windows, one number each, subtract — and a rep who booked two appointments
 * last month and three this month is "up 50%". So every comparison here refuses
 * unless BOTH windows cleared their own sample floor, and the direction is only
 * named when the change is bigger than the noise the smaller sample could
 * produce on its own.
 */

export type Direction = 'improving' | 'stable' | 'declining' | 'unknown'

export interface Trend {
  label: string
  previous: number | null
  current: number | null
  /** Relative change. Null whenever either side is missing. */
  change: number | null
  direction: Direction
  /** Always populated, including when the answer is "cannot say". */
  note: string
}

/**
 * Below this relative change, a movement is called stable.
 *
 * Ten per cent is a judgement call and is meant to be one: door knocking is
 * noisy, weather moves contact rate more than coaching does, and a dashboard
 * that declares a trend every fortnight trains people to ignore it.
 */
export const MEANINGFUL_CHANGE = 0.1

export function trendOf(label: string, previous: Rate, current: Rate): Trend {
  const base = { label, previous: previous.value, current: current.value }

  if (previous.value === null || current.value === null) {
    const which = previous.value === null ? 'the earlier window' : 'this window'
    return {
      ...base,
      change: null,
      direction: 'unknown',
      note: `Not enough in ${which} to compare. ${(previous.value === null ? previous.unavailable : current.unavailable) ?? ''}`.trim(),
    }
  }
  if (previous.value === 0) {
    return {
      ...base,
      change: null,
      direction: 'unknown',
      // Dividing by zero here is how "up 300%" gets printed about one extra sale.
      note: 'The earlier window was zero, so there is no percentage to report. Compare the counts instead.',
    }
  }

  const change = (current.value - previous.value) / previous.value
  const direction: Direction =
    Math.abs(change) < MEANINGFUL_CHANGE ? 'stable' : change > 0 ? 'improving' : 'declining'

  return {
    ...base,
    change,
    direction,
    note:
      direction === 'stable'
        ? `Within ${Math.round(MEANINGFUL_CHANGE * 100)}% of the earlier window, which is not a change worth acting on.`
        : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(change * 100))}% on ${previous.denominator} then against ${current.denominator} now.`,
  }
}

/**
 * One sentence about a set of trends, written from the trends themselves.
 *
 * Deliberately refuses to average directions into a single verdict. "Field
 * productivity improved while follow-up discipline weakened" is a true and
 * useful sentence; "overall: improving" from the same data is neither.
 */
export function summarise(trends: readonly Trend[]): string {
  const up = trends.filter((t) => t.direction === 'improving').map((t) => t.label.toLowerCase())
  const down = trends.filter((t) => t.direction === 'declining').map((t) => t.label.toLowerCase())
  const unknown = trends.filter((t) => t.direction === 'unknown').length

  if (up.length === 0 && down.length === 0) {
    return unknown === trends.length
      ? 'Not enough in one or both windows to compare anything yet.'
      : 'Nothing moved by more than the noise between these two windows.'
  }
  const parts: string[] = []
  if (up.length > 0) parts.push(`${up.join(', ')} improved`)
  if (down.length > 0) parts.push(`${down.join(', ')} weakened`)
  const tail = unknown > 0 ? ` ${unknown} measure${unknown === 1 ? '' : 's'} could not be compared.` : ''
  return `${parts.join(' while ')}.${tail}`
}
