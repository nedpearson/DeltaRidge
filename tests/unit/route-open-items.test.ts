import { describe, expect, it } from 'vitest'
import { groupOpenItems, openItems } from '@/features/routes/open-items'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { DoorEvent } from '@/features/routes/route-stats'

/**
 * The unfinished list at the end of a route.
 *
 * What is being tested is mostly what it REFUSES to say. A list that nags a rep
 * about doors they correctly closed, or that counts one lead twice, gets
 * dismissed without reading - and then the items that mattered are lost along
 * with the noise.
 */

const NOW = '2026-09-24T21:47:00.000Z'

function lead(overrides: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '142 OAK RIDGE DR|70810',
    address: '142 OAK RIDGE DR',
    latitude: 30.41,
    longitude: -91.18,
    score: 61,
    reasons: [],
    status: 'follow_up',
    createdAt: NOW,
    updatedAt: NOW,
    knockCount: 1,
    ...overrides,
  }
}

function knock(leadId: string): DoorEvent {
  return {
    leadId,
    at: NOW,
    activityType: 'door_knock',
    outcome: 'spoke',
    gpsVerification: 'verified',
  }
}

describe('open items', () => {
  it('names a lead worked today with nothing scheduled', () => {
    const items = openItems({
      leads: [lead()],
      events: [knock('lead-1')],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('no_next_action')
  })

  /**
   * The load-bearing silence. A rep who closed a door correctly has finished
   * their job there and must not be nagged for it.
   */
  it('says nothing about a door that is correctly closed', () => {
    for (const status of ['not_interested', 'do_not_knock'] as const) {
      const items = openItems({
        leads: [lead({ status })],
        events: [knock('lead-1')],
        now: NOW,
      })
      expect(items, status).toHaveLength(0)
    }
  })

  it('names an inspection started at the door and not finished', () => {
    const items = openItems({
      leads: [lead({ status: 'inspected', inspectionId: 'insp-1', nextActionAt: NOW })],
      events: [knock('lead-1')],
      inspections: [{ id: 'insp-1', status: 'in_progress' }],
      now: NOW,
    })
    expect(items[0]?.kind).toBe('inspection_incomplete')
  })

  it('says nothing about an inspection that was finished', () => {
    const items = openItems({
      leads: [lead({ status: 'inspected', inspectionId: 'insp-1', nextActionAt: '2026-10-01T15:00:00.000Z' })],
      events: [knock('lead-1')],
      inspections: [{ id: 'insp-1', status: 'complete' }],
      now: NOW,
    })
    expect(items).toHaveLength(0)
  })

  it('catches an appointment booked with no date on it', () => {
    const items = openItems({
      leads: [lead({ status: 'appointment' })],
      events: [knock('lead-1')],
      now: NOW,
    })
    expect(items[0]?.kind).toBe('appointment_without_date')
  })

  it('leaves an appointment with a date alone', () => {
    const items = openItems({
      leads: [
        lead({
          status: 'appointment',
          appointmentAt: '2026-09-30T15:00:00.000Z',
          nextActionAt: '2026-09-30T15:00:00.000Z',
        }),
      ],
      events: [knock('lead-1')],
      now: NOW,
    })
    expect(items).toHaveLength(0)
  })

  it('surfaces something already due and something due tomorrow', () => {
    const items = openItems({
      leads: [
        lead({ id: 'a', address: 'A ST', nextActionAt: '2026-09-20T15:00:00.000Z' }),
        lead({ id: 'b', address: 'B ST', nextActionAt: '2026-09-25T14:00:00.000Z' }),
      ],
      events: [knock('a'), knock('b')],
      now: NOW,
    })
    expect(items.map((i) => i.kind)).toEqual(['due_soon', 'due_soon'])
    expect(items.find((i) => i.leadId === 'a')?.detail).toContain('Already due')
  })

  it('leaves a follow-up next week out of the end-of-day list', () => {
    const items = openItems({
      leads: [lead({ nextActionAt: '2026-10-05T15:00:00.000Z' })],
      events: [knock('lead-1')],
      now: NOW,
    })
    expect(items).toHaveLength(0)
  })

  /**
   * One lead is one thing to go and fix. Listing it twice makes the count at
   * the top of the screen wrong in the direction that causes panic.
   */
  it('reports a lead once even when several things are open on it', () => {
    const items = openItems({
      leads: [lead({ status: 'appointment', inspectionId: 'insp-1' })],
      events: [knock('lead-1')],
      inspections: [{ id: 'insp-1', status: 'in_progress' }],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('inspection_incomplete')
  })

  /**
   * Scope. A rep who knocked eleven doors must not be handed the whole
   * pipeline's unfinished business at 5pm.
   */
  it('only covers leads this route actually touched', () => {
    const items = openItems({
      leads: [lead({ id: 'a' }), lead({ id: 'untouched', address: 'ELSEWHERE' })],
      events: [knock('a')],
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.leadId).toBe('a')
  })

  it('is stable across two runs of the same route', () => {
    const input = {
      leads: [lead({ id: 'b', address: 'B ST' }), lead({ id: 'a', address: 'A ST' })],
      events: [knock('a'), knock('b')],
      now: NOW,
    }
    expect(openItems(input)).toEqual(openItems(input))
    expect(openItems(input).map((i) => i.address)).toEqual(['A ST', 'B ST'])
  })

  it('groups for a screen and drops the empty groups', () => {
    const groups = groupOpenItems(
      openItems({ leads: [lead()], events: [knock('lead-1')], now: NOW }),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('no_next_action')
  })
})
