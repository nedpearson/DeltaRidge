import { describe, expect, it } from 'vitest'
import { buildMailerRows, mailerCsv, type MailerProperty } from './mailer'

const base: MailerProperty = {
  id: 'aaaaaaaa-1111-4000-8000-000000000001',
  address_line1: '1 Oak St',
  city: 'Baton Rouge',
  state: 'LA',
  postal_code: '70808',
  owner_name: 'Jane Doe',
  owner_mailing_address: null,
  owner_type: 'individual',
  roof_age_years: 18,
  last_roof_permit_date: null,
}
const opts = {
  minRoofAge: 12,
  includeUnknownAge: false,
  baseUrl: 'https://deltaridge.bridgebox.ai',
  campaign: 'storm-202610',
  suppressedIds: new Set<string>(),
}
const now = new Date('2026-10-08T12:00:00Z')

describe('buildMailerRows', () => {
  it('includes an old roof with a tracked QR link', () => {
    const [row] = buildMailerRows([base], opts, now)
    expect(row?.refCode).toBe('AAAAAAAA11')
    expect(row?.qrUrl).toBe('https://deltaridge.bridgebox.ai/free-roof-check?ref=AAAAAAAA11&utm_source=mailer&utm_campaign=storm-202610')
    expect(row?.mailTo).toBe('1 Oak St, Baton Rouge, LA 70808')
  })

  it('lets a recent re-roof permit override a stale age estimate', () => {
    expect(buildMailerRows([{ ...base, last_roof_permit_date: '2021-05-01' }], opts, now)).toHaveLength(0)
  })

  it('drops young roofs, unknown ages unless asked, and suppressed homes', () => {
    expect(buildMailerRows([{ ...base, roof_age_years: 6 }], opts, now)).toHaveLength(0)
    expect(buildMailerRows([{ ...base, roof_age_years: null }], opts, now)).toHaveLength(0)
    expect(buildMailerRows([{ ...base, roof_age_years: null }], { ...opts, includeUnknownAge: true }, now)).toHaveLength(1)
    expect(buildMailerRows([base], { ...opts, suppressedIds: new Set([base.id]) }, now)).toHaveLength(0)
  })

  it('mails absentee owners at their own address and falls back to Current Resident', () => {
    const [row] = buildMailerRows([{ ...base, owner_name: null, owner_mailing_address: 'PO Box 9, Houston, TX' }], opts, now)
    expect(row?.recipient).toBe('Current Resident')
    expect(row?.mailTo).toBe('PO Box 9, Houston, TX')
  })
})

describe('mailerCsv', () => {
  it('quotes cells containing commas', () => {
    const csv = mailerCsv(buildMailerRows([base], opts, now))
    expect(csv.split('\n')[1]).toContain('"1 Oak St, Baton Rouge, LA 70808"')
  })
})
