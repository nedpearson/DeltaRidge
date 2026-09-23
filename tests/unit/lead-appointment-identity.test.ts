import { describe, expect, it } from 'vitest'
import { applyOutcome, type ManagedLead } from '@/features/leads/pipeline'

/**
 * An appointment is a commitment a homeowner made on a date. Two of them, six
 * months apart, are two commitments — and the push used to key both on the
 * lead, so the second UPSERT erased the first.
 */

function lead(over: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '123 oak st',
    address: '123 Oak St',
    latitude: 30.4,
    longitude: -91.1,
    score: 55,
    reasons: [],
    status: 'new',
    createdAt: '2026-03-01T15:00:00.000Z',
    updatedAt: '2026-03-01T15:00:00.000Z',
    knockCount: 0,
    ...over,
  }
}

describe('appointment identity', () => {
  it('gives an appointment the id of the knock that agreed it', () => {
    const { lead: after, event } = applyOutcome(lead(), 'appointment_set', '2026-09-23T15:00:00.000Z', {
      appointmentAt: '2026-09-25T14:00:00.000Z',
    })
    expect(after.appointmentClientId).toBe(event.id)
    expect(after.appointmentAt).toBe('2026-09-25T14:00:00.000Z')
  })

  it('gives a second appointment a different identity from the first', () => {
    // The exact loss: keyed on the lead, this second row would have overwritten
    // the record of the visit the homeowner already kept.
    const first = applyOutcome(lead(), 'appointment_set', '2026-03-02T15:00:00.000Z', {
      appointmentAt: '2026-03-04T14:00:00.000Z',
    })
    const second = applyOutcome(first.lead, 'appointment_set', '2026-09-23T15:00:00.000Z', {
      appointmentAt: '2026-09-25T14:00:00.000Z',
    })
    expect(second.lead.appointmentClientId).not.toBe(first.lead.appointmentClientId)
  })

  it('leaves the identity alone for outcomes that are not an appointment', () => {
    const booked = applyOutcome(lead(), 'appointment_set', '2026-09-23T15:00:00.000Z', {
      appointmentAt: '2026-09-25T14:00:00.000Z',
    })
    const knocked = applyOutcome(booked.lead, 'no_answer', '2026-09-24T15:00:00.000Z')
    expect(knocked.lead.appointmentClientId).toBe(booked.lead.appointmentClientId)
  })

  it('clears the identity along with the appointment when someone says no', () => {
    // Leaving it behind would let a later push write a row for an appointment
    // that no longer exists.
    const booked = applyOutcome(lead(), 'appointment_set', '2026-09-23T15:00:00.000Z', {
      appointmentAt: '2026-09-25T14:00:00.000Z',
    })
    for (const outcome of ['not_interested', 'do_not_knock'] as const) {
      const after = applyOutcome(booked.lead, outcome, '2026-09-24T15:00:00.000Z')
      expect(after.appointmentAt, outcome).toBeUndefined()
      expect(after.appointmentClientId, outcome).toBeUndefined()
    }
  })

  it('still records the knock that set the appointment as its own event', () => {
    const { event } = applyOutcome(lead(), 'appointment_set', '2026-09-23T15:00:00.000Z', {
      appointmentAt: '2026-09-25T14:00:00.000Z',
    })
    expect(event.kind).toBe('appointment_set')
    expect(event.leadId).toBe('lead-1')
  })
})
