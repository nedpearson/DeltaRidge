import { describe, expect, it } from 'vitest'
import { byAddress, promote, suppressedKeys } from '@/features/leads/lead-store'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { PermitRecord } from '@/integrations/permits/types'
import type { StormEvent } from '@/integrations/storm'

const AT = '2026-09-20T15:00:00.000Z'

const PERMIT = {
  externalId: 'p1',
  address: '19615 FAIRWAY OAKS AVE',
  addressKey: '19615 fairway oaks ave|70809',
  issuedAt: '2014-04-30',
  kind: 'new_build',
} as unknown as PermitRecord

const STORM = {
  externalId: 's1',
  provider: 'noaa',
  eventType: 'hail',
  occurredAt: '2025-03-31T20:00:00Z',
  hailSizeInches: 1.75,
  latitude: 30.36,
  longitude: -91.05,
} as StormEvent

function door(overrides: Partial<ScoredLead> = {}): ScoredLead {
  return {
    addressKey: '19615 fairway oaks ave|70809',
    address: '19615 FAIRWAY OAKS AVE BATON ROUGE LA 70809',
    latitude: 30.36,
    longitude: -91.05,
    roofPermit: PERMIT,
    city: 'BATON ROUGE',
    postalCode: '70809',
    subdivision: 'SANTA MARIA',
    score: 43,
    components: { hailSizeInches: 1.75, daysSinceStorm: 538, distanceMiles: 0.6, roofAgeYears: 12 },
    storm: STORM,
    reasons: ['1.75" hail reported 0.6 mi away on Mar 31, 2025'],
    ...overrides,
  }
}

function managed(overrides: Partial<ManagedLead> = {}): ManagedLead {
  return { ...promote(door(), AT), ...overrides }
}

describe('promoting a door', () => {
  it('starts as new with nobody having knocked', () => {
    const lead = promote(door(), AT)
    expect(lead.status).toBe('new')
    expect(lead.knockCount).toBe(0)
    expect(lead.createdAt).toBe(AT)
  })

  it('keeps the address key so a later run can find it again', () => {
    expect(promote(door(), AT).addressKey).toBe('19615 fairway oaks ave|70809')
  })

  it('copies the reasons rather than sharing them with the run', () => {
    const d = door()
    const lead = promote(d, AT)
    d.reasons.push('something tomorrow')
    expect(lead.reasons).toHaveLength(1)
  })

  it('freezes the priority as it stood at the knock', () => {
    expect(promote(door({ score: 43 }), AT).score).toBe(43)
  })

  it('leaves out a field the door does not have rather than storing undefined', () => {
    const bare = door()
    delete (bare as { subdivision?: string }).subdivision
    expect('subdivision' in promote(bare, AT)).toBe(false)
  })
})

describe('doors the rep must not be shown again', () => {
  it('suppresses do-not-knock and not-interested, and nothing else', () => {
    const keys = suppressedKeys([
      managed({ addressKey: 'a', status: 'do_not_knock' }),
      managed({ addressKey: 'b', status: 'not_interested' }),
      managed({ addressKey: 'c', status: 'follow_up' }),
      managed({ addressKey: 'd', status: 'appointment' }),
    ])
    expect([...keys].sort()).toEqual(['a', 'b'])
  })

  it('indexes leads by address so the door list can show their status', () => {
    const index = byAddress([managed({ addressKey: 'a' }), managed({ addressKey: 'b' })])
    expect(index.get('a')?.addressKey).toBe('a')
    expect(index.get('zzz')).toBeUndefined()
  })
})
