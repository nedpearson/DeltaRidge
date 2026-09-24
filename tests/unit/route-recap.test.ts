import { describe, expect, it } from 'vitest'
import {
  buildFunnel,
  outcomeBreakdown,
  rateLabel,
  OUTCOME_ORDER,
} from '@/features/routes/recap'
import type { DoorEvent } from '@/features/routes/route-stats'

/**
 * The end-of-route recap.
 *
 * The thing under test is mostly restraint. Counting knocks is easy; the hard
 * part is refusing to report a stage nobody measured as a zero, and refusing to
 * divide by a denominator that does not exist. Both mistakes produce a number
 * that looks like a rep's performance and is actually the software's ignorance.
 */

const AT = '2026-09-24T15:00:00.000Z'

function knock(leadId: string, outcome: string): DoorEvent {
  return { leadId, at: AT, activityType: 'door_knock', outcome, gpsVerification: 'verified' }
}

describe('outcome breakdown', () => {
  it('counts each outcome a rep actually chose', () => {
    const rows = outcomeBreakdown([
      knock('a', 'no_answer'),
      knock('b', 'no_answer'),
      knock('c', 'spoke'),
      knock('d', 'appointment_set'),
    ])
    const by = new Map(rows.map((r) => [r.outcome, r.count]))
    expect(by.get('no_answer')).toBe(2)
    expect(by.get('spoke')).toBe(1)
    expect(by.get('appointment_set')).toBe(1)
  })

  it('keeps zero rows by default, because the shape of a day includes what did not happen', () => {
    const rows = outcomeBreakdown([knock('a', 'no_answer')])
    expect(rows).toHaveLength(OUTCOME_ORDER.length)
    expect(rows.find((r) => r.outcome === 'spoke')?.count).toBe(0)
  })

  it('trims to what happened when asked', () => {
    const rows = outcomeBreakdown([knock('a', 'no_answer')], { nonZero: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBe('no_answer')
  })

  /**
   * An outcome from an older or newer client must not appear as a category. It
   * would sit in the breakdown looking like a real one.
   */
  it('drops an outcome this build does not recognise', () => {
    const rows = outcomeBreakdown([knock('a', 'sold_them_a_boat')], { nonZero: true })
    expect(rows).toHaveLength(0)
  })

  /**
   * Regression. RoutePanel maps an appointment-set knock's kind to
   * 'appointment' before it reaches here, so matching only 'door_knock'
   * silently dropped the best door of the day out of both the breakdown and
   * the funnel. Found by reading the caller, not by the tests above passing.
   */
  it('counts an appointment-set door, which the caller relabels as appointment', () => {
    const rows = outcomeBreakdown(
      [
        {
          leadId: 'a',
          at: AT,
          activityType: 'appointment',
          outcome: 'appointment_set',
          gpsVerification: 'verified',
        },
      ],
      { nonZero: true },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBe('appointment_set')
  })

  it('ignores events that are not knocks', () => {
    const rows = outcomeBreakdown(
      [{ leadId: 'a', at: AT, activityType: 'call_placed', outcome: 'spoke', gpsVerification: null }],
      { nonZero: true },
    )
    expect(rows).toHaveLength(0)
  })
})

describe('funnel', () => {
  const day: DoorEvent[] = [
    knock('a', 'no_answer'),
    knock('b', 'no_answer'),
    knock('c', 'spoke'),
    knock('d', 'interested'),
    knock('e', 'wants_inspection'),
    knock('f', 'appointment_set'),
    knock('g', 'inspect_now'),
  ]

  it('counts a booked door as a door, not only as an appointment', () => {
    const funnel = buildFunnel([
      {
        leadId: 'a',
        at: AT,
        activityType: 'appointment',
        outcome: 'appointment_set',
        gpsVerification: 'verified',
      },
    ])
    const by = new Map(funnel.stages.map((s) => [s.key, s.count]))
    expect(by.get('doors')).toBe(1)
    expect(by.get('conversations')).toBe(1)
    expect(by.get('appointments')).toBe(1)
  })

  it('counts doors, not knocks', () => {
    const repeat = [knock('a', 'no_answer'), knock('a', 'no_answer'), knock('a', 'spoke')]
    const funnel = buildFunnel(repeat)
    expect(funnel.stages.find((s) => s.key === 'doors')?.count).toBe(1)
  })

  it('separates interest from conversation', () => {
    const funnel = buildFunnel(day)
    const by = new Map(funnel.stages.map((s) => [s.key, s.count]))
    // spoke, interested, wants_inspection, appointment_set, inspect_now all
    // count as conversations; only two of them are interest.
    expect(by.get('conversations')).toBe(5)
    expect(by.get('interested')).toBe(2)
  })

  /**
   * The load-bearing refusal. A stage with no source is left out entirely and
   * named, rather than reported as zero, because "0 sales" and "sales are not
   * counted here" read identically on a dashboard and mean opposite things.
   */
  it('omits stages it cannot measure and names them', () => {
    const funnel = buildFunnel(day)
    expect(funnel.stages.map((s) => s.key)).not.toContain('sales')
    expect(funnel.unmeasured).toEqual(['estimates', 'proposals', 'sales'])
  })

  it('includes a stage the caller can prove, including a real zero', () => {
    const funnel = buildFunnel(day, { estimatesCreated: 2, proposalsSent: 1, sales: 0 })
    const by = new Map(funnel.stages.map((s) => [s.key, s.count]))
    expect(by.get('sales')).toBe(0)
    expect(funnel.unmeasured).toEqual([])
  })

  it('prefers a completed inspection count over what happened at the door', () => {
    const atDoor = buildFunnel(day)
    expect(atDoor.stages.find((s) => s.key === 'inspections')?.count).toBe(1)

    const withSource = buildFunnel(day, { inspectionsCompleted: 3 })
    expect(withSource.stages.find((s) => s.key === 'inspections')?.count).toBe(3)
  })

  it('computes each rate against the stage above it', () => {
    const funnel = buildFunnel(day)
    const conversations = funnel.stages.find((s) => s.key === 'conversations')
    // 5 conversations from 7 doors.
    expect(conversations?.rate).toBeCloseTo(5 / 7)
  })

  it('never divides by a denominator that is zero', () => {
    const funnel = buildFunnel([], { estimatesCreated: 0, proposalsSent: 0, sales: 0 })
    for (const stage of funnel.stages) {
      expect(stage.count).toBe(0)
      // Doors has nothing above it; everything else has a zero above it.
      expect(stage.rate).toBeNull()
    }
  })

  it('gives the first stage no rate, having nothing to convert from', () => {
    expect(buildFunnel(day).stages[0]?.rate).toBeNull()
  })

  it('renders an absent rate as a dash rather than a zero', () => {
    expect(rateLabel(null)).toBe('—')
    expect(rateLabel(0)).toBe('0%')
    expect(rateLabel(5 / 7)).toBe('71%')
  })
})
