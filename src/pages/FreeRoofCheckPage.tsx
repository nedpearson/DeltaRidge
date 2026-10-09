import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { ClaimAnswer, DamageAnswer, InsuranceAnswer, RoofAgeAnswer } from '@/features/leads/heat'

/**
 * Public storm-check funnel — the in-house replacement for bought storm leads.
 *
 * Mailers (QR with ?ref=), ads (?utm_*), yard signs and the website all land
 * here. Four short steps on a phone: address → three tap questions → a time →
 * name, phone and an optional consent box. The edge function scores it and
 * puts it at the top of every rep's list.
 *
 * Wording is deliberately conservative. Louisiana bars contractors from
 * interpreting coverage or waiving deductibles (La. R.S. 37:2159.1, 51:451),
 * so nothing here says "free roof" or "insurance will pay".
 */

const COMPANY = (import.meta.env.VITE_COMPANY_NAME as string | undefined) || 'Delta Ridge Roofing'

export const CONSENT_TEXT =
  `By checking this box, I agree that ${COMPANY} may call and text me at the number above about my ` +
  'inspection request and roofing services, including with automated technology and prerecorded or AI voice ' +
  'messages. Consent is not a condition of any purchase. Message and data rates may apply. Reply STOP to opt out.'

interface StormResult {
  found: boolean
  matchedAddress?: string
  storm?: { maxHailInches: number | null; daysSince: number | null; date: string | null; unavailable: boolean }
}

type Step = 'address' | 'questions' | 'time' | 'contact' | 'done'

/** Next six working days (Mon–Sat), four slots each, in the visitor's local time. */
export function inspectionSlots(from: Date = new Date()): Date[] {
  const slots: Date[] = []
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let days = 0
  while (days < 6) {
    day.setDate(day.getDate() + 1)
    if (day.getDay() === 0) continue
    days += 1
    for (const hour of [9, 11, 14, 16]) {
      slots.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))
    }
  }
  return slots
}

function Tile({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        'min-h-14 w-full rounded-xl px-4 py-3 text-left text-[15px] font-semibold transition-colors ' +
        (selected
          ? 'bg-brand-primary text-white ring-2 ring-brand-hover'
          : 'bg-bg-card text-text-primary ring-1 ring-border-strong active:bg-bg-elevated')
      }
    >
      {children}
    </button>
  )
}

function Question<T extends string>({ label, value, onChange, options }: {
  label: string
  value: T | null
  onChange: (v: T) => void
  options: ReadonlyArray<readonly [T, string]>
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-[15px] font-bold text-text-primary">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map(([v, text]) => (
          <Tile key={v} selected={value === v} onClick={() => onChange(v)}>{text}</Tile>
        ))}
      </div>
    </fieldset>
  )
}

function stormMessage(r: StormResult | null): { tone: 'hit' | 'none' | 'unknown'; text: string } {
  if (!r || !r.found) return { tone: 'unknown', text: "We couldn't match that address automatically. That's fine — an inspector will check in person." }
  const s = r.storm
  if (!s || s.unavailable) return { tone: 'unknown', text: 'Storm records are slow to respond right now. An inspector will check the storm history in person.' }
  if (s.maxHailInches !== null && s.maxHailInches >= 1 && s.date) {
    const when = new Date(s.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    return {
      tone: 'hit',
      text: `NOAA radar estimated hail up to ${s.maxHailInches.toFixed(2)}" near this address on ${when}. Hail that size can damage shingles without leaving damage you can see from the ground.`,
    }
  }
  return { tone: 'none', text: 'No large radar-estimated hail on record near this address in the last two years. Wind and age damage are still worth checking.' }
}

export default function FreeRoofCheckPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const startedAt = useRef(Date.now())
  const [step, setStep] = useState<Step>('address')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [address, setAddress] = useState('')
  const [storm, setStorm] = useState<StormResult | null>(null)

  const [owner, setOwner] = useState<'yes' | 'no' | null>(null)
  const [damage, setDamage] = useState<DamageAnswer | null>(null)
  const [roofAge, setRoofAge] = useState<RoofAgeAnswer | null>(null)
  const [insurance, setInsurance] = useState<InsuranceAnswer | null>(null)
  const [carrier, setCarrier] = useState('')
  const [claim, setClaim] = useState<ClaimAnswer | null>(null)

  const slots = useMemo(() => inspectionSlots(), [])
  const [slot, setSlot] = useState<Date | null>(null)
  const [callToSchedule, setCallToSchedule] = useState(false)
  const [decisionMakers, setDecisionMakers] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [booked, setBooked] = useState(false)

  useEffect(() => {
    document.title = `Storm Roof Check · ${COMPANY}`
    window.scrollTo({ top: 0 })
  }, [step])

  async function call(body: Record<string, unknown>) {
    const supabase = getSupabase()
    if (!supabase) throw new Error('This page is not connected right now. Please call us.')
    const { data, error: fnError } = await supabase.functions.invoke('storm-inspection-request', { body })
    if (fnError) {
      const ctx = (fnError as { context?: Response }).context
      const detail = ctx ? await ctx.json().catch(() => null) as { error?: string } | null : null
      throw new Error(detail?.error || 'Something went wrong. Please try again.')
    }
    return data as Record<string, unknown>
  }

  async function onCheck(e: FormEvent) {
    e.preventDefault()
    if (address.trim().length < 6) { setError('Enter the street address, city and ZIP.'); return }
    setBusy(true); setError(null)
    try {
      setStorm(await call({ action: 'check', address }) as unknown as StormResult)
    } catch {
      setStorm({ found: false })
    } finally {
      setBusy(false)
      setStep('questions')
    }
  }

  const questionsDone = owner && damage && roofAge && insurance && claim

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await call({
        action: 'submit',
        address: storm?.matchedAddress || address,
        owner: owner === 'yes',
        damage, roofAge, insurance, claim,
        carrier: carrier.trim(),
        preferredStart: slot && !callToSchedule ? slot.toISOString() : null,
        decisionMakers,
        name, phone, email,
        consent,
        consentText: consent ? CONSENT_TEXT : '',
        company: honeypot,
        elapsedMs: Date.now() - startedAt.current,
        ref: params.get('ref') ?? '',
        utm_source: params.get('utm_source') ?? '',
        utm_medium: params.get('utm_medium') ?? '',
        utm_campaign: params.get('utm_campaign') ?? '',
      })
      setBooked(Boolean(res.booked))
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const msg = stormMessage(storm)
  const stepIndex = ['address', 'questions', 'time', 'contact'].indexOf(step)

  return (
    <div className="min-h-screen bg-bg-app text-text-primary">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        <header className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-gold">{COMPANY}</p>
          <h1 className="mt-1 font-display text-[clamp(1.6rem,7vw,2.1rem)] font-bold leading-tight">Storm Roof Check</h1>
          {step !== 'done' && (
            <div className="mt-4 flex gap-1.5" aria-label={`Step ${stepIndex + 1} of 4`}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={'h-1.5 flex-1 rounded-full ' + (i <= stepIndex ? 'bg-brand-gold' : 'bg-bg-elevated')} />
              ))}
            </div>
          )}
        </header>

        {error && (
          <div role="alert" className="mb-4 rounded-xl bg-status-critical/12 px-4 py-3 text-sm font-semibold text-status-critical ring-1 ring-status-critical/30">
            {error}
          </div>
        )}

        {step === 'address' && (
          <form onSubmit={onCheck} className="space-y-4">
            <p className="text-[15px] leading-relaxed text-text-secondary">
              See whether hail hit near your home, then book a no-cost roof inspection with a written photo report.
            </p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">Property address</span>
              <input
                autoComplete="street-address"
                inputMode="text"
                className="min-h-14 w-full rounded-xl bg-bg-card px-4 text-[17px] text-text-primary ring-1 ring-border-strong placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-brand-primary"
                placeholder="123 Main St, Baton Rouge, LA 70808"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <button disabled={busy} className="min-h-14 w-full rounded-xl bg-brand-gold text-[17px] font-bold text-[#101827] disabled:opacity-60">
              {busy ? 'Checking storm records…' : 'Check my address'}
            </button>
            <p className="text-xs leading-relaxed text-text-muted">Storm data: NOAA National Centers for Environmental Information radar hail records.</p>
          </form>
        )}

        {step === 'questions' && (
          <div className="space-y-6">
            <div className={
              'rounded-xl px-4 py-3 text-[14px] leading-relaxed ring-1 ' +
              (msg.tone === 'hit' ? 'bg-warning-surface text-text-primary ring-warning-border' : 'bg-bg-card text-text-secondary ring-border-subtle')
            }>
              {storm?.matchedAddress && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-text-muted">{storm.matchedAddress}</p>}
              {msg.text}
            </div>

            <Question label="Do you own this home?" value={owner} onChange={setOwner}
              options={[['yes', 'Yes, I own it'], ['no', 'No, I rent']] as const} />
            <Question label="What have you noticed?" value={damage} onChange={setDamage}
              options={[['leak', 'A leak or water stain'], ['visible', 'Missing or damaged shingles'], ['unsure', 'Not sure — want it checked'], ['none', 'Nothing yet']] as const} />
            <Question label="About how old is the roof?" value={roofAge} onChange={setRoofAge}
              options={[['over15', '15+ years'], ['10to15', '10–15 years'], ['5to10', '5–10 years'], ['under5', 'Under 5 years'], ['unknown', "I don't know"]] as const} />
            <Question label="Do you carry homeowners insurance?" value={insurance} onChange={setInsurance}
              options={[['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] as const} />
            {insurance === 'yes' && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">Insurance company <span className="font-normal text-text-muted">(optional)</span></span>
                <input className="min-h-12 w-full rounded-xl bg-bg-card px-4 text-[16px] ring-1 ring-border-strong focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="e.g. State Farm" />
              </label>
            )}
            <Question label="Have you contacted your insurance company about the roof?" value={claim} onChange={setClaim}
              options={[['filed', 'Yes, a claim is open'], ['want_documentation', 'Not yet — I want it documented first'], ['not_yet', 'Not yet']] as const} />

            <button disabled={!questionsDone} onClick={() => setStep(owner === 'no' ? 'contact' : 'time')}
              className="min-h-14 w-full rounded-xl bg-brand-gold text-[17px] font-bold text-[#101827] disabled:opacity-40">
              Continue
            </button>
          </div>
        )}

        {step === 'time' && (
          <div className="space-y-5">
            <h2 className="text-lg font-bold">Pick an inspection time</h2>
            <p className="text-sm text-text-secondary">About 45 minutes. We'll call to confirm before we come.</p>
            <div className="space-y-4">
              {Array.from(new Set(slots.map((s) => s.toDateString()))).map((day) => (
                <div key={day}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
                    {new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {slots.filter((s) => s.toDateString() === day).map((s) => (
                      <button key={s.toISOString()} type="button"
                        onClick={() => { setSlot(s); setCallToSchedule(false) }}
                        aria-pressed={slot?.getTime() === s.getTime()}
                        className={'min-h-12 rounded-lg text-sm font-bold ' + (slot?.getTime() === s.getTime() && !callToSchedule
                          ? 'bg-brand-primary text-white' : 'bg-bg-card ring-1 ring-border-strong')}>
                        {s.toLocaleTimeString(undefined, { hour: 'numeric' })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Tile selected={callToSchedule} onClick={() => { setCallToSchedule(true); setSlot(null) }}>Just call me to set a time</Tile>
            <label className="flex min-h-12 items-center gap-3 rounded-xl bg-bg-card px-4 ring-1 ring-border-subtle">
              <input type="checkbox" className="size-5" checked={decisionMakers} onChange={(e) => setDecisionMakers(e.target.checked)} />
              <span className="text-sm">Everyone who decides on the roof can be there</span>
            </label>
            <button disabled={!slot && !callToSchedule} onClick={() => setStep('contact')}
              className="min-h-14 w-full rounded-xl bg-brand-gold text-[17px] font-bold text-[#101827] disabled:opacity-40">
              Continue
            </button>
            <button type="button" onClick={() => setStep('questions')} className="w-full py-2 text-sm text-text-muted">Back</button>
          </div>
        )}

        {step === 'contact' && (
          <form onSubmit={onSubmit} className="space-y-4">
            <h2 className="text-lg font-bold">Where should we reach you?</h2>
            {owner === 'no' && (
              <p className="rounded-xl bg-bg-card px-4 py-3 text-sm text-text-secondary ring-1 ring-border-subtle">
                We'll need the owner's OK before inspecting. Leave your details and we'll explain how it works.
              </p>
            )}
            <input className="min-h-14 w-full rounded-xl bg-bg-card px-4 text-[17px] ring-1 ring-border-strong focus:outline-none focus:ring-2 focus:ring-brand-primary"
              autoComplete="name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className="min-h-14 w-full rounded-xl bg-bg-card px-4 text-[17px] ring-1 ring-border-strong focus:outline-none focus:ring-2 focus:ring-brand-primary"
              type="tel" inputMode="tel" autoComplete="tel" placeholder="Mobile phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <input className="min-h-14 w-full rounded-xl bg-bg-card px-4 text-[17px] ring-1 ring-border-strong focus:outline-none focus:ring-2 focus:ring-brand-primary"
              type="email" inputMode="email" autoComplete="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0"
              value={honeypot} onChange={(e) => setHoneypot(e.target.value)} name="company" />

            <label className="flex items-start gap-3 rounded-xl bg-bg-card p-4 ring-1 ring-border-subtle">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-[12.5px] leading-relaxed text-text-secondary">{CONSENT_TEXT}</span>
            </label>

            <button disabled={busy} className="min-h-14 w-full rounded-xl bg-brand-gold text-[17px] font-bold text-[#101827] disabled:opacity-60">
              {busy ? 'Sending…' : 'Request my inspection'}
            </button>
            <p className="text-[11.5px] leading-relaxed text-text-muted">
              {COMPANY} inspects and documents roof condition. Only your insurance company can decide what your policy covers.
              We never pay, waive or rebate insurance deductibles. Licensed Louisiana contractor.
            </p>
            <button type="button" onClick={() => setStep(owner === 'no' ? 'questions' : 'time')} className="w-full py-2 text-sm text-text-muted">Back</button>
          </form>
        )}

        {step === 'done' && (
          <div className="space-y-4 rounded-2xl bg-bg-card p-6 ring-1 ring-border-subtle">
            <h2 className="font-display text-2xl font-bold">You're on the list</h2>
            <p className="text-[15px] leading-relaxed text-text-secondary">
              {booked
                ? "We have your requested time. A member of our team will call shortly to confirm it."
                : 'A member of our team will call shortly to set a time that works for you.'}
            </p>
            <p className="text-sm text-text-muted">Tip: if you can, note where any leaks or stains are before we arrive.</p>
          </div>
        )}
      </div>
    </div>
  )
}
