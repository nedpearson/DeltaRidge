import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLeadListScroll,
  readLeadListContext,
  writeLeadListContext,
} from '@/features/navigation/lead-list-context'

describe('lead list navigation context', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns safe defaults when nothing is stored', () => {
    expect(readLeadListContext()).toEqual({
      tab: 'new',
      routeName: null,
      ownerOccupiedOnly: false,
      showCompetitors: false,
      scrollY: 0,
    })
  })

  it('round trips list state used before a drill-down', () => {
    writeLeadListContext({
      tab: 'follow_up',
      routeName: 'Oak Hills',
      ownerOccupiedOnly: true,
      showCompetitors: true,
      scrollY: 1480,
    })

    expect(readLeadListContext()).toEqual({
      tab: 'follow_up',
      routeName: 'Oak Hills',
      ownerOccupiedOnly: true,
      showCompetitors: true,
      scrollY: 1480,
    })
  })

  it('sanitises malformed stored values instead of crashing navigation', () => {
    sessionStorage.setItem(
      'delta-ridge:leads-context',
      JSON.stringify({
        tab: 'bogus',
        routeName: 42,
        ownerOccupiedOnly: 'yes',
        showCompetitors: null,
        scrollY: -500,
      }),
    )

    expect(readLeadListContext()).toEqual({
      tab: 'new',
      routeName: null,
      ownerOccupiedOnly: false,
      showCompetitors: false,
      scrollY: 0,
    })
  })

  it('can reset only the saved scroll without losing filters', () => {
    writeLeadListContext({
      tab: 'appointments',
      routeName: 'Southdowns',
      ownerOccupiedOnly: true,
      showCompetitors: false,
      scrollY: 900,
    })
    clearLeadListScroll()
    expect(readLeadListContext()).toMatchObject({
      tab: 'appointments',
      routeName: 'Southdowns',
      ownerOccupiedOnly: true,
      scrollY: 0,
    })
  })

  it('treats unavailable session storage as a convenience failure, not an app failure', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() =>
      writeLeadListContext({
        tab: 'new',
        routeName: null,
        ownerOccupiedOnly: false,
        showCompetitors: false,
        scrollY: 0,
      }),
    ).not.toThrow()
    spy.mockRestore()
  })
})
