export const CONTACT_DISCLOSURE = 'I request contact from Delta Ridge about this inspection by phone or email. This does not enroll me in marketing or guarantee an appointment.'

export interface InspectionIntake {
  requestKey: string
  name: string
  address: string
  phone: string
  email: string
  preferredDay: string
  notes: string
  contactConsent: boolean
  website: string
  attribution: Record<string, string>
}

export function validateIntake(input: InspectionIntake, today = new Date().toISOString().slice(0, 10)): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(input.requestKey)) return 'Please reload the form and try again.'
  if (input.name.trim().length < 2 || input.name.length > 120) return 'Enter your name.'
  if (input.address.trim().length < 8 || input.address.length > 300) return 'Enter your full property address, including city and ZIP.'
  if (!input.phone.trim() && !input.email.trim()) return 'Enter a phone number or email so we can confirm your inspection.'
  if (input.phone && !/^\+?1?\d{10}$/.test(input.phone.replace(/[\s().-]/g, ''))) return 'Enter a valid US phone number.'
  if (input.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254)) return 'Enter a valid email address.'
  if (input.preferredDay && (!/^\d{4}-\d{2}-\d{2}$/.test(input.preferredDay) || !Number.isFinite(Date.parse(input.preferredDay)) || new Date(input.preferredDay).toISOString().slice(0,10) !== input.preferredDay || input.preferredDay < today)) return 'Choose today or a future date.'
  if (input.notes.length > 2000) return 'Keep inspection notes under 2,000 characters.'
  if (!input.contactConsent) return 'Authorize contact so we can respond to your request.'
  return null
}

export function captureAttribution(search: string): Record<string, string> {
  const params = new URLSearchParams(search)
  return Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'gclid', 'fbclid']
    .flatMap(key => params.get(key) ? [[key, params.get(key)!.slice(0, 200)]] : []))
}

export function acquisitionEconomics(spend: number, leads: number, appointments: number, won: number) {
  return {
    cpl: leads > 0 ? spend / leads : null,
    appointmentRate: leads > 0 ? appointments / leads : null,
    closeRate: appointments > 0 ? won / appointments : null,
    cac: won > 0 ? spend / won : null,
  }
}
