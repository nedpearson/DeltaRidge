import { useCallback, useState, type FormEvent } from 'react'
import { getSupabase } from '@/lib/supabase'
import { CONTACT_DISCLOSURE, captureAttribution, validateIntake, type InspectionIntake } from '@/features/acquisition/intake'
import SecurityCheck from '@/features/acquisition/SecurityCheck'

export default function FreeRoofCheckPage() {
  const [step, setStep] = useState<'address'|'request'|'saved'>('address')
  const [exposure, setExposure] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [reset, setReset] = useState(0)
  const onToken = useCallback((value: string) => setToken(value), [])
  const [input, setInput] = useState<InspectionIntake>(() => ({ requestKey: crypto.randomUUID(), name: '', address: '', phone: '', email: '', preferredDay: '', notes: '', contactConsent: false, website: '', attribution: captureAttribution(window.location.search) }))
  const update = (key: keyof InspectionIntake, value: string | boolean) => setInput(prev => ({ ...prev, [key]: value }))
  const resetSecurity = () => { setToken(''); setReset(n => n + 1) }
  async function lookup(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const db = getSupabase()
      if (!db || !token) throw new Error('Complete the security check before looking up your address.')
      const { data, error: lookupError } = await db.functions.invoke('public-inspection-request', { body: { action: 'lookup', address: input.address, captchaToken: token } })
      if (lookupError || data?.error) throw new Error('Storm data is unavailable. You can still request an inspection.')
      setExposure(data?.status === 'exposed' ? 'Recorded storm activity overlaps this property’s location. This does not establish roof damage.' : 'We cannot determine storm exposure from the available records. An inspection can assess your roof.')
      setStep('request')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to check this address.') }
    finally { setBusy(false); resetSecurity() }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const validation = validateIntake(input)
    if (validation) { setError(validation); return }
    const db = getSupabase()
    if (!db || !token) { setError('Complete the security check before submitting.'); return }
    setBusy(true); setError('')
    try {
      const { data, error: saveError } = await db.functions.invoke('public-inspection-request', { body: { ...input, captchaToken: token } })
      if (saveError || data?.success !== true) throw new Error(data?.error || 'We could not save your request. Please retry or contact the office.')
      setStep('saved')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save your request.') }
    finally { setBusy(false); resetSecurity() }
  }
  const field = (key: 'name'|'address'|'phone'|'email'|'preferredDay', label: string, type = 'text', required = false) => <label className="block text-sm font-medium text-slate-800">{label}<input className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900" type={type} value={input[key]} required={required} maxLength={key === 'address' ? 300 : 254} min={type === 'date' ? new Date().toISOString().slice(0,10) : undefined} onChange={e => update(key,e.target.value)} /></label>
  return <main className="min-h-screen bg-slate-100 px-4 py-12 text-slate-900"><div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow-lg sm:p-10">
    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-blue-700">Delta Ridge Roofing</p>
    <h1 className="text-3xl font-bold">Free roof inspection</h1>
    <p className="mt-3 mb-6 text-slate-600">Check available storm records and request a visit. Roof damage and insurance coverage require separate verification.</p>
    {step === 'saved' ? <section role="status"><h2 className="text-xl font-bold">Your request is saved</h2><p className="mt-3">Our team will contact you to confirm the date and time. Your preferred day is a request, and no appointment is booked yet.</p><a className="mt-6 inline-block text-blue-700 underline" href="/free-roof-check">Request another inspection</a></section> : <>
      {exposure && <p className="mb-5 rounded-lg bg-blue-50 p-4 text-sm">{exposure}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <form onSubmit={step === 'address' ? lookup : submit} className="space-y-4">
        {field('address','Property address, city and ZIP','text',true)}
        {step === 'request' && <>{field('name','Your name','text',true)}{field('phone','Phone','tel')}{field('email','Email','email')}{field('preferredDay','Preferred day (team will confirm)','date')}
          <label className="block text-sm font-medium">What would you like checked?<textarea value={input.notes} maxLength={2000} onChange={e => update('notes',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3" /></label>
          <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={input.contactConsent} onChange={e => update('contactConsent',e.target.checked)} />{CONTACT_DISCLOSURE}</label>
          <p className="text-xs text-slate-600">Your name, address and contact details are stored by Delta Ridge to respond to this inspection request. We do not add you to a marketing list through this form.</p>
          <label className="hidden" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={input.website} onChange={e=>update('website',e.target.value)} /></label>
        </>}
        <SecurityCheck onToken={onToken} reset={reset} />
        <button disabled={busy || !token} className="w-full rounded-lg bg-blue-700 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : step === 'address' ? 'Check storm records' : 'Request free inspection'}</button>
        {step === 'address' && <button type="button" disabled={busy} onClick={()=>{setStep('request');setError('');resetSecurity()}} className="w-full p-3 text-blue-700 underline">Request an inspection without storm lookup</button>}
      </form>
    </>}
  </div></main>
}
