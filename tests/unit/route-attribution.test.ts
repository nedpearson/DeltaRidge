import { describe, expect, it } from 'vitest'
import { applyOutcome, type ManagedLead } from '@/features/leads/pipeline'

/**
 * Which route a knock happened on.
 *
 * Before this, nothing recorded it. A route's doors were found by asking for
 * activities whose timestamp fell between the session's start and stop, in the
 * browser. That is a guess, and it is wrong in the three cases that matter
 * most in the field:
 *
 *   - an activity written offline and synced hours later, after the window the
 *     client was holding has gone;
 *   - a rep who forgets to end a route, whose window then swallows the next
 *     morning's work;
 *   - anyone server-side - a manager, an end-of-day report - who would have to
 *     re-derive the window per rep, per session, in SQL.
 *
 * So it is stamped once, at capture, from the open session. These tests pin
 * that it is stamped when a route is running and, just as importantly, left
 * absent when one is not.
 */

const NOW = '2026-09-24T15:30:00.000Z'
const ROUTE = '11111111-2222-3333-4444-555555555555'

function lead(): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '142 OAK RIDGE DR|70810',
    address: '142 OAK RIDGE DR BATON ROUGE LA 70810',
    latitude: 30.41,
    longitude: -91.18,
    score: 61,
    reasons: ['2.25" radar estimate 1.1 mi away'],
    status: 'new',
    createdAt: NOW,
    updatedAt: NOW,
    knockCount: 0,
  }
}

describe('route attribution', () => {
  it('stamps the open route on a knock', () => {
    const { event } = applyOutcome(lead(), 'no_answer', NOW, { routeSessionId: ROUTE })
    expect(event.routeSessionId).toBe(ROUTE)
  })

  /**
   * The load-bearing absence. A call from the truck or a follow-up typed at a
   * desk belongs to no route, and must not acquire one.
   */
  it('leaves the field absent when no route is running', () => {
    const { event } = applyOutcome(lead(), 'no_answer', NOW, {})
    expect(event.routeSessionId).toBeUndefined()
    expect('routeSessionId' in event).toBe(false)
  })

  it('carries it on every outcome a rep can record, not just knocks', () => {
    for (const outcome of ['spoke', 'appointment_set', 'not_interested', 'inspect_now'] as const) {
      const { event } = applyOutcome(lead(), outcome, NOW, { routeSessionId: ROUTE })
      expect(event.routeSessionId, outcome).toBe(ROUTE)
    }
  })

  /**
   * The stamp is evidence about the knock, exactly like the GPS record beside
   * it, and neither may change what the knock itself says happened.
   */
  it('does not change the outcome, status or knock count', () => {
    const base = lead()
    const withRoute = applyOutcome(base, 'spoke', NOW, { routeSessionId: ROUTE })
    const without = applyOutcome(base, 'spoke', NOW, {})

    expect(withRoute.lead.status).toBe(without.lead.status)
    expect(withRoute.lead.knockCount).toBe(without.lead.knockCount)
    expect(withRoute.event.outcome).toBe(without.event.outcome)
    expect(withRoute.event.kind).toBe(without.event.kind)
  })
})
