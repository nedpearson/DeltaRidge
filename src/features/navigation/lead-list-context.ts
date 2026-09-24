export type LeadListTab = 'new' | 'follow_up' | 'need_visit' | 'appointments'

export interface LeadListContext {
  tab: LeadListTab
  routeName: string | null
  ownerOccupiedOnly: boolean
  showCompetitors: boolean
  scrollY: number
}

const KEY = 'delta-ridge:leads-context'

const DEFAULT: LeadListContext = {
  tab: 'new',
  routeName: null,
  ownerOccupiedOnly: false,
  showCompetitors: false,
  scrollY: 0,
}

export function readLeadListContext(): LeadListContext {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<LeadListContext>
    const tab =
      parsed.tab === 'new' ||
      parsed.tab === 'follow_up' ||
      parsed.tab === 'need_visit' ||
      parsed.tab === 'appointments'
        ? parsed.tab
        : 'new'
    return {
      tab,
      routeName: typeof parsed.routeName === 'string' ? parsed.routeName : null,
      ownerOccupiedOnly: parsed.ownerOccupiedOnly === true,
      showCompetitors: parsed.showCompetitors === true,
      scrollY:
        typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY)
          ? Math.max(0, parsed.scrollY)
          : 0,
    }
  } catch {
    return DEFAULT
  }
}

export function writeLeadListContext(context: LeadListContext): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(context))
  } catch {
    // Navigation state is a convenience, never something field work depends on.
  }
}

export function clearLeadListScroll(): void {
  const current = readLeadListContext()
  writeLeadListContext({ ...current, scrollY: 0 })
}
