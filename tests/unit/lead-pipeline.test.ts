import { describe, expect, it } from 'vitest'
import {
  applyOutcome,
  chipCounts,
  dueLabel,
  isDue,
  isSuppressed,
  sortForField,
  type DoorOutcome,
  type LeadStatus,
  type ManagedLead,
} from '@/features/leads/pipeline'

const AT = '2026-09-20T15:00:00.000Z'

function lead(overrides: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '19615 FAIRWAY OAKS AVE|70809',
    address: '19615 FAIRWAY OAKS AVE BATON ROUGE LA 70809',
    latitude: 30.36,
    longitude: -91.05,
    score: 43,
    reasons: ['1.75" hail reported 0.6 mi away on Mar 31, 2025'],
    status: 'new',
    createdAt: AT,
    updatedAt: AT,
    knockCount: 0,
    ...overrides,
  }
}

describe('door outcomes', () => {
  const cases: [DoorOutcome, LeadStatus][] = [
    ['no_answer', 'attempted'],
    ['come_back', 'follow_up'],
    ['interested', 'need_visit'],
    ['appointment_set', 'appointment'],
    ['inspect_now', 'inspected'],
    ['not_interested', 'not_interested'],
    ['do_not_knock', 'do_not_knock'],
  ]

  it.each(cases)('%s moves the lead to %s', (outcome, status) => {
    const { lead: next } = applyOutcome(lead(), outcome, AT)
    expect(next.status).toBe(status)
  })

  it('never mutates the lead it was given', () => {
    const original = lead()
    applyOutcome(original, 'not_interested', AT)
    expect(original.status).toBe('new')
    expect(original.knockCount).toBe(0)
  })

  it('counts a knock for every outcome recorded at the door', () => {
    const { lead: next } = applyOutcome(lead({ knockCount: 2 }), 'no_answer', AT)
    expect(next.knockCount).toBe(3)
  })

  it('does not count a knock when the request was not to be knocked on', () => {
    const { lead: next } = applyOutcome(lead({ knockCount: 2 }), 'do_not_knock', AT)
    expect(next.knockCount).toBe(2)
  })

  it('schedules a return visit for a door nobody answered', () => {
    const { lead: next } = applyOutcome(lead(), 'no_answer', AT)
    expect(next.nextActionAt).toBe('2026-09-22T15:00:00.000Z')
  })

  it('schedules tomorrow for somebody who said they are interested', () => {
    const { lead: next } = applyOutcome(lead(), 'interested', AT)
    expect(next.nextActionAt).toBe('2026-09-21T15:00:00.000Z')
  })

  it('leaves no return visit on a door that said no', () => {
    const { lead: next } = applyOutcome(lead(), 'not_interested', AT)
    expect(next.nextActionAt).toBeUndefined()
    expect('nextActionAt' in next).toBe(false)
  })

  it('lets the rep override the default interval', () => {
    const { lead: next } = applyOutcome(lead(), 'no_answer', AT, {
      followUpAt: '2026-10-01T15:00:00.000Z',
    })
    expect(next.nextActionAt).toBe('2026-10-01T15:00:00.000Z')
  })

  it('an appointment sets both the agreed time and the next action', () => {
    const { lead: next } = applyOutcome(lead(), 'appointment_set', AT, {
      appointmentAt: '2026-09-23T14:00:00.000Z',
    })
    expect(next.appointmentAt).toBe('2026-09-23T14:00:00.000Z')
    expect(next.nextActionAt).toBe('2026-09-23T14:00:00.000Z')
  })

  it('clears a stale appointment when the door says no', () => {
    const booked = lead({ status: 'appointment', appointmentAt: '2026-09-23T14:00:00.000Z' })
    const { lead: next } = applyOutcome(booked, 'not_interested', AT)
    expect('appointmentAt' in next).toBe(false)
  })

  it('writes an event that carries the outcome and the note', () => {
    const { event } = applyOutcome(lead(), 'come_back', AT, { note: 'Back after 6' })
    expect(event.kind).toBe('door_knock')
    expect(event.outcome).toBe('come_back')
    expect(event.note).toBe('Back after 6')
    expect(event.at).toBe(AT)
  })

  it('omits an empty note rather than storing a blank one', () => {
    const { event } = applyOutcome(lead(), 'no_answer', AT, { note: '' })
    expect('note' in event).toBe(false)
  })
})

describe('the four numbers across the top', () => {
  it('folds not-home in with come-back, because both owe another visit', () => {
    const counts = chipCounts(
      [
        lead({ id: 'a', status: 'attempted' }),
        lead({ id: 'b', status: 'follow_up' }),
        lead({ id: 'c', status: 'need_visit' }),
        lead({ id: 'd', status: 'appointment' }),
        lead({ id: 'e', status: 'not_interested' }),
      ],
      92,
    )
    expect(counts).toEqual({ newDoors: 92, followUp: 2, needVisit: 1, appointments: 1 })
  })

  it('counts nothing towards the pipeline for a door that said no', () => {
    const counts = chipCounts([lead({ status: 'do_not_knock' })], 0)
    expect(counts).toEqual({ newDoors: 0, followUp: 0, needVisit: 0, appointments: 0 })
  })
})

describe('suppression', () => {
  it('keeps a do-not-knock door off every list', () => {
    expect(isSuppressed(lead({ status: 'do_not_knock' }))).toBe(true)
  })

  it('keeps a door that said no off the list too', () => {
    expect(isSuppressed(lead({ status: 'not_interested' }))).toBe(true)
  })

  it('leaves a door owed a follow-up on the list', () => {
    expect(isSuppressed(lead({ status: 'follow_up' }))).toBe(false)
  })
})

describe('working order', () => {
  it('puts appointments first, then what is due, then what is coming', () => {
    const ordered = sortForField(
      [
        lead({ id: 'later', status: 'follow_up', nextActionAt: '2026-09-25T15:00:00.000Z' }),
        lead({ id: 'due', status: 'attempted', nextActionAt: '2026-09-19T15:00:00.000Z' }),
        lead({ id: 'none', status: 'new' }),
        lead({ id: 'appt', status: 'appointment', appointmentAt: '2026-09-30T15:00:00.000Z', nextActionAt: '2026-09-30T15:00:00.000Z' }),
      ],
      AT,
    )
    expect(ordered.map((l) => l.id)).toEqual(['appt', 'due', 'later', 'none'])
  })

  it('breaks a tie on priority', () => {
    const ordered = sortForField(
      [lead({ id: 'low', score: 10 }), lead({ id: 'high', score: 80 })],
      AT,
    )
    expect(ordered.map((l) => l.id)).toEqual(['high', 'low'])
  })
})

describe('due wording', () => {
  it('says nothing when nothing is owed', () => {
    expect(dueLabel(lead(), AT)).toBeNull()
  })

  it('names an appointment as an appointment, not a follow-up', () => {
    const l = lead({ status: 'appointment', appointmentAt: '2026-09-21T14:00:00.000Z' })
    expect(dueLabel(l, AT)).toBe('Appointment tomorrow')
  })

  it('says how far overdue a missed follow-up is', () => {
    const l = lead({ status: 'attempted', nextActionAt: '2026-09-17T15:00:00.000Z' })
    expect(dueLabel(l, AT)).toBe('Back 3 days overdue')
  })

  it('marks a lead due when its time has passed', () => {
    expect(isDue(lead({ nextActionAt: '2026-09-19T00:00:00.000Z' }), AT)).toBe(true)
    expect(isDue(lead({ nextActionAt: '2026-09-21T00:00:00.000Z' }), AT)).toBe(false)
  })
})
