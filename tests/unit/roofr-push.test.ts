import { describe, expect, it } from 'vitest'
import {
  buildJobPayload,
  eligibility,
  externalJobId,
  phoneMayTravel,
  statusRank,
  type PushCandidate,
  type PushSettings,
} from '../../supabase/functions/roofr-push/payload'

const lead: PushCandidate = {
  leadId: '188efbc5-c0d1-498e-b555-cde1f30fdd9d',
  status: 'appointment',
  firstName: 'Dana',
  lastName: 'Whitfield',
  companyName: null,
  email: 'dana@example.com',
  phone: '(225) 555-0142',
  phoneSource: 'homeowner_at_door',
  addressLine1: '18818 Bella Vista Ct',
  city: 'Baton Rouge',
  state: 'LA',
  postalCode: '70809',
  alreadyLinked: false,
}

const on: PushSettings = { pushEnabled: true, threshold: 'inspection_scheduled' }

describe('eligibility', () => {
  it('lets a qualified lead through', () => {
    expect(eligibility(lead, on)).toEqual({ ok: true })
  })

  it('refuses everything while the connection is off', () => {
    // The whole outbound leg is gated on this, because Roofr''s own help page
    // still describes the integration as one-way.
    const result = eligibility(lead, { ...on, pushEnabled: false })
    expect(result.ok).toBe(false)
  })

  it('refuses a lead that has not reached the threshold', () => {
    const result = eligibility({ ...lead, status: 'no_answer' }, on)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no_answer')
    expect(result.reason).toContain('appointment')
  })

  it('refuses a lead with no homeowner name rather than inventing one', () => {
    const result = eligibility(
      { ...lead, firstName: null, lastName: null, companyName: null },
      on,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('not invented')
  })

  it('treats a whitespace-only name as no name', () => {
    const result = eligibility({ ...lead, firstName: '   ', lastName: '', companyName: null }, on)
    expect(result.ok).toBe(false)
  })

  it('accepts a company with no personal name', () => {
    expect(
      eligibility({ ...lead, firstName: null, lastName: null, companyName: 'Whitfield LLC' }, on),
    ).toEqual({ ok: true })
  })

  it('refuses a lead already in Roofr, which is what stops a second job', () => {
    expect(eligibility({ ...lead, alreadyLinked: true }, on).ok).toBe(false)
  })

  it('refuses a do_not_contact lead at any threshold', () => {
    expect(eligibility({ ...lead, status: 'do_not_contact' }, on).ok).toBe(false)
    expect(
      eligibility({ ...lead, status: 'do_not_contact' }, { ...on, threshold: 'manual_only' }).ok,
    ).toBe(false)
  })

  it('lets a person decide when the threshold says a person decides', () => {
    // manual_only and manager_approved are not points on the status ladder, so
    // an early-stage lead is allowed through when a manager explicitly asks.
    expect(eligibility({ ...lead, status: 'target' }, { ...on, threshold: 'manual_only' })).toEqual({
      ok: true,
    })
    expect(
      eligibility({ ...lead, status: 'target' }, { ...on, threshold: 'manager_approved' }),
    ).toEqual({ ok: true })
  })

  it('still refuses a nameless lead even when a manager asks', () => {
    const result = eligibility(
      { ...lead, firstName: null, lastName: null, companyName: null, status: 'sold' },
      { ...on, threshold: 'manual_only' },
    )
    expect(result.ok).toBe(false)
  })
})

describe('statusRank', () => {
  it('orders the ladder the way a door actually progresses', () => {
    expect(statusRank('target')).toBeLessThan(statusRank('spoke'))
    expect(statusRank('spoke')).toBeLessThan(statusRank('appointment'))
    expect(statusRank('appointment')).toBeLessThan(statusRank('sold'))
  })

  it('ranks a status off the ladder below everything, so it cannot pass a threshold', () => {
    expect(statusRank('do_not_contact')).toBe(-1)
    expect(statusRank('existing_customer')).toBe(-1)
  })
})

describe('phone provenance', () => {
  it('lets a number the homeowner gave us travel', () => {
    expect(phoneMayTravel('homeowner_at_door')).toBe(true)
    expect(phoneMayTravel('homeowner_by_phone')).toBe(true)
    expect(phoneMayTravel('homeowner_in_writing')).toBe(true)
  })

  it('keeps a looked-up number out of Roofr', () => {
    // Copying it across would put it in front of an office with a click-to-call
    // button and none of the context that makes Delta Ridge refuse to dial it.
    expect(phoneMayTravel('third_party_lookup')).toBe(false)
    expect(phoneMayTravel('public_record')).toBe(false)
    expect(phoneMayTravel('unknown')).toBe(false)
    expect(phoneMayTravel(null)).toBe(false)
  })
})

describe('buildJobPayload', () => {
  it('sends what we have and nothing we do not', () => {
    const payload = buildJobPayload(lead)
    expect(payload.customer.first_name).toBe('Dana')
    expect(payload.customer.phone).toBe('(225) 555-0142')
    expect(payload.address.line1).toBe('18818 Bella Vista Ct')
    expect(payload.job_name).toBe('Dana Whitfield - 18818 Bella Vista Ct')
  })

  it('withholds a looked-up number while still sending the job', () => {
    const payload = buildJobPayload({ ...lead, phoneSource: 'third_party_lookup' })
    expect(payload.customer.phone).toBeNull()
    expect(payload.customer.first_name).toBe('Dana')
  })

  it('never emits an empty string where a value is absent', () => {
    const payload = buildJobPayload({ ...lead, email: '  ', city: '', companyName: '' })
    expect(payload.customer.email).toBeNull()
    expect(payload.address.city).toBeNull()
    expect(payload.customer.company_name).toBeNull()
  })

  it('names the job after a company when there is no person', () => {
    const payload = buildJobPayload({
      ...lead,
      firstName: null,
      lastName: null,
      companyName: 'Whitfield LLC',
    })
    expect(payload.job_name).toBe('Whitfield LLC - 18818 Bella Vista Ct')
  })

  it('derives the external id from the lead, so a retry cannot make a second job', () => {
    expect(buildJobPayload(lead).external_job_id).toBe(externalJobId(lead.leadId))
    expect(buildJobPayload(lead).external_job_id).toBe(buildJobPayload({ ...lead }).external_job_id)
  })
})
