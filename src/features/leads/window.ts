/**
 * Storm windows, including an explicit current-year one.
 *
 * "Last 24 months" hid the answer to the question actually being asked. A rep
 * looking at a door list in September wants to know what happened THIS YEAR,
 * and a rolling window buries four 2026 events under twenty-two from 2025
 * without ever saying so.
 *
 * Every window resolves to an explicit [from, to] so the engine, the tests and
 * the screen all agree on the dates, and the label is carried with it so the
 * UI never has to re-derive "2026 STORMS" from a month count.
 */

export type StormWindowKey =
  | 'this_year'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_6_months'
  | 'last_12_months'
  | 'last_24_months'
  | 'custom'

export interface ResolvedWindow {
  readonly key: StormWindowKey
  readonly from: string
  readonly to: string
  /** What the screen calls it. "2026 storms", not "last 9 months". */
  readonly label: string
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return d
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return d
}

export interface CustomRange {
  readonly from: string
  readonly to: string
}

export function resolveWindow(
  key: StormWindowKey,
  now: Date,
  custom?: CustomRange,
): ResolvedWindow {
  const to = now.toISOString()

  switch (key) {
    case 'this_year': {
      // January 1 of the current year, local time, so a rep in Louisiana in
      // early January is not told the year started tomorrow.
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
      return {
        key,
        from: start.toISOString(),
        to,
        label: `${now.getFullYear()} storms`,
      }
    }
    case 'last_30_days':
      return { key, from: daysAgo(now, 30).toISOString(), to, label: 'Last 30 days' }
    case 'last_90_days':
      return { key, from: daysAgo(now, 90).toISOString(), to, label: 'Last 90 days' }
    case 'last_6_months':
      return { key, from: monthsAgo(now, 6).toISOString(), to, label: 'Last 6 months' }
    case 'last_12_months':
      return { key, from: monthsAgo(now, 12).toISOString(), to, label: 'Last 12 months' }
    case 'last_24_months':
      return { key, from: monthsAgo(now, 24).toISOString(), to, label: 'Last 24 months' }
    case 'custom': {
      if (!custom) {
        // Falling back silently to a rolling window would show a different set
        // of storms than the dates on screen.
        return {
          key,
          from: monthsAgo(now, 24).toISOString(),
          to,
          label: 'Custom range not set - showing last 24 months',
        }
      }
      return {
        key,
        from: new Date(custom.from).toISOString(),
        to: new Date(custom.to).toISOString(),
        label: `${custom.from} to ${custom.to}`,
      }
    }
  }
}

export const WINDOW_OPTIONS: readonly { key: StormWindowKey; label: string }[] = [
  { key: 'this_year', label: 'This year' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'last_6_months', label: 'Last 6 months' },
  { key: 'last_12_months', label: 'Last 12 months' },
  { key: 'last_24_months', label: 'Last 24 months' },
  { key: 'custom', label: 'Custom range' },
]

/** Events grouped by calendar year, newest first, for the coverage panel. */
export function countByYear(
  occurredAt: readonly string[],
): readonly { readonly year: string; readonly count: number }[] {
  const counts = new Map<string, number>()
  for (const iso of occurredAt) {
    const year = iso.slice(0, 4)
    counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year.localeCompare(a.year))
}
