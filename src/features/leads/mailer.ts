import { mailerRefCode } from './heat'

/**
 * Storm mailer list: the outbound half of the in-house lead engine.
 *
 * The vendors that cold-call storm zones are, in Louisiana, mostly not legal
 * to copy: the LPSC order bars solicitation calls to cell phones without prior
 * consent, and texting a skip-traced list needs written consent nobody has.
 * Mail has no such rule. So the outbound channel here is a postcard to every
 * old-roof home in the hail swath, each carrying a QR code back to the storm
 * check page with that property's ref code — which is how a response is tied
 * to the exact house that was mailed and the cost per lead is measurable.
 */

export interface MailerProperty {
  readonly id: string
  readonly address_line1: string
  readonly city: string | null
  readonly state: string | null
  readonly postal_code: string | null
  readonly owner_name: string | null
  readonly owner_mailing_address: string | null
  readonly owner_type: string | null
  readonly roof_age_years: number | null
  readonly last_roof_permit_date: string | null
}

export interface MailerOptions {
  readonly minRoofAge: number
  readonly includeUnknownAge: boolean
  readonly baseUrl: string
  readonly campaign: string
  readonly suppressedIds: ReadonlySet<string>
}

export interface MailerRow {
  readonly recipient: string
  readonly mailTo: string
  readonly propertyAddress: string
  readonly roofAge: string
  readonly refCode: string
  readonly qrUrl: string
}

/** Years since a re-roof permit, when that beats the stored estimate. */
function effectiveRoofAge(p: MailerProperty, now: Date): number | null {
  if (p.last_roof_permit_date) {
    const t = Date.parse(p.last_roof_permit_date)
    if (Number.isFinite(t)) return Math.floor((now.getTime() - t) / (365.25 * 86_400_000))
  }
  return p.roof_age_years
}

export function buildMailerRows(props: readonly MailerProperty[], opts: MailerOptions, now: Date = new Date()): MailerRow[] {
  const rows: MailerRow[] = []
  for (const p of props) {
    if (opts.suppressedIds.has(p.id)) continue
    const age = effectiveRoofAge(p, now)
    if (age === null ? !opts.includeUnknownAge : age < opts.minRoofAge) continue
    const ref = mailerRefCode(p.id)
    const propertyAddress = [p.address_line1, p.city, [p.state, p.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    // Absentee owners get the card at their mailing address, addressed to them.
    const absentee = Boolean(p.owner_mailing_address && p.owner_mailing_address.trim())
    const url = new URL('/free-roof-check', opts.baseUrl)
    url.searchParams.set('ref', ref)
    url.searchParams.set('utm_source', 'mailer')
    url.searchParams.set('utm_campaign', opts.campaign)
    rows.push({
      recipient: p.owner_name?.trim() || 'Current Resident',
      mailTo: absentee ? p.owner_mailing_address!.trim() : propertyAddress,
      propertyAddress,
      roofAge: age === null ? 'unknown' : String(age),
      refCode: ref,
      qrUrl: url.toString(),
    })
  }
  return rows
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function mailerCsv(rows: readonly MailerRow[]): string {
  const header = ['recipient', 'mail_to', 'property_address', 'roof_age_years', 'ref_code', 'qr_url']
  const lines = rows.map((r) => [r.recipient, r.mailTo, r.propertyAddress, r.roofAge, r.refCode, r.qrUrl].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\n') + '\n'
}
