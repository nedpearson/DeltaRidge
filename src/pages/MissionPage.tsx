import { useEffect, useState } from 'react'
import { readLeads, saveOutcome } from '@/features/leads/lead-store'
import { applyOutcome, type DoorOutcome, type ManagedLead } from '@/features/leads/pipeline'
import { MapPin, User, X, Calendar, ChevronRight, Navigation } from 'lucide-react'
import { useRepToday } from '@/features/dashboard/useRepToday'
import { Link, useNavigate } from 'react-router-dom'

export default function MissionPage() {
  const navigate = useNavigate()
  const { data: todayData } = useRepToday()
  const [leads, setLeads] = useState<ManagedLead[]>([])
  const [loading, setLoading] = useState(true)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeError, setOutcomeError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [outcomeFlow, setOutcomeFlow] = useState<'none' | 'spoke' | 'appointment'>('none')
  
  // Spoke state
  const [spokeName, setSpokeName] = useState('')
  const [spokePhone, setSpokePhone] = useState('')
  
  // Appt state
  const [apptSlot, setApptSlot] = useState<string>('')

  useEffect(() => {
    async function load() {
      const allLeads = await readLeads()
      const pending = allLeads.filter(l => l.status === 'new' || l.status === 'attempted' || l.status === 'follow_up')
      pending.sort((a, b) => b.score - a.score)
      setLeads(pending)
      setLoading(false)
    }
    void load().catch((err) => {
      setOutcomeError(err instanceof Error ? err.message : 'Could not load the route.')
      setLoading(false)
    })
  }, [])

  const currentLead = leads[currentIndex]

  const handleOutcome = async (outcome: DoorOutcome, extra?: { contactName?: string; contactPhone?: string; appointmentAt?: string }) => {
    if (!currentLead) return
    if (savingOutcome) return
    setSavingOutcome(true)
    setOutcomeError(null)
    const at = new Date().toISOString()
    const { lead: nextLead, event } = applyOutcome(currentLead, outcome, at, extra)

    try {
      await saveOutcome(nextLead, event)
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : 'Could not save this outcome.')
      setSavingOutcome(false)
      return
    }

    setOutcomeFlow('none')
    setSpokeName('')
    setSpokePhone('')
    setApptSlot('')
    setCurrentIndex(i => i + 1)
    setSavingOutcome(false)
  }

  const handleQuickTap = (outcome: DoorOutcome) => {
    if (outcome === 'spoke') {
      setOutcomeFlow('spoke')
    } else if (outcome === 'appointment_set') {
      setOutcomeFlow('appointment')
    } else {
      void handleOutcome(outcome)
    }
  }

  const handleSpokeSave = () => {
    void handleOutcome('spoke', {
      contactName: spokeName,
      contactPhone: spokePhone
    })
  }

  const handleApptSave = () => {
    const parsed = Date.parse(apptSlot)
    if (!apptSlot || !Number.isFinite(parsed)) return
    void handleOutcome('appointment_set', {
      appointmentAt: new Date(parsed).toISOString(),
      contactName: spokeName,
      contactPhone: spokePhone
    })
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100dvh-var(--app-header-height,0px)-var(--bottom-nav-height,0px))] flex items-center justify-center bg-[var(--color-bg-app)] text-[var(--color-text-secondary)]">
        Loading route…
      </div>
    )
  }

  if (!currentLead) {
    return (
      <div className="flex flex-col h-full bg-[var(--color-bg-app)] text-[var(--color-text-primary)] min-h-[calc(100dvh-var(--app-header-height,0px)-var(--bottom-nav-height,0px))] items-center justify-center p-6">
        <h1 className="text-2xl font-bold text-[var(--color-brand-primary)]">MISSION COMPLETE</h1>
        <p className="text-[var(--color-text-secondary)] mt-2">You have finished your queue.</p>
        <Link to="/" className="mt-8 bg-[var(--color-bg-card)] border border-[var(--color-border-strong)] px-6 min-h-11 rounded-xl text-[var(--color-brand-primary)] font-semibold">Back to Home</Link>
      </div>
    )
  }

  const remaining = leads.length - currentIndex

  return (
    <div className="flex min-h-[calc(100dvh-var(--app-header-height,0px)-var(--bottom-nav-height,0px))] flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-page)] px-4 py-3">
        <div>
          <h1 className="truncate text-base font-bold text-[var(--color-brand-hover)] uppercase">MISSION: {todayData?.activeCampaign || 'DAILY ROUTE'}</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">Remaining doors: <span className="font-bold text-white">{remaining}</span></p>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
        
        {outcomeFlow === 'none' && (
          <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] p-4 sm:p-5">
            <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-brand-gold)]" />
            <h2 className="text-xs font-semibold text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">Next Property</h2>
            
            <div className="mb-4">
              <p className="break-words font-display text-[clamp(1.65rem,8vw,2.25rem)] font-bold leading-tight">{currentLead.address.split(',')[0]}</p>
              <p className="text-[var(--color-text-secondary)] text-sm flex items-center gap-1 mt-1">
                <MapPin size={14} />
                {currentLead.address}
              </p>
            </div>
            
            <div className="flex gap-4 mb-4">
               <div className="bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] px-3 py-2 rounded">
                 <span className="text-[var(--color-text-muted)] text-xs block uppercase">Score</span>
                 <span className="text-lg font-bold text-[var(--color-status-success)]">{currentLead.score}</span>
               </div>
            </div>

            <div className="bg-[var(--color-bg-app)] rounded p-4 mb-6 border border-[var(--color-border-subtle)]">
              <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase">Why Selected</h3>
              <ul className="text-sm space-y-1">
                {currentLead.reasons?.map((r, i) => (
                  <li key={i} className="flex gap-2 items-start">
                    <span className="text-[var(--color-brand-primary)] mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                )) || <li>Highest scored lead in area</li>}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-5">
              <button
                onClick={() => navigate(`/map?focus=${encodeURIComponent(currentLead.id)}`)}
                className="col-span-2 bg-[var(--color-brand-primary)] hover:bg-[var(--color-brand-hover)] text-white font-bold min-h-12 rounded-xl-lg shadow-lg flex items-center justify-center gap-2 text-lg"
              >
                <Navigation size={20} />
                Open on Map
              </button>
              <Link to={`/lead/${currentLead.id}`} className="bg-[var(--color-bg-elevated)] hover:bg-[var(--color-border-strong)] text-white font-semibold min-h-11 rounded-xl-lg border border-[var(--color-border-subtle)] flex items-center justify-center gap-2 text-base">
                <User size={18} />
                Lead 360
              </Link>
              <button onClick={() => setCurrentIndex(i => i + 1)} className="bg-[var(--color-bg-elevated)] hover:bg-[var(--color-border-strong)] text-[var(--color-text-secondary)] font-semibold min-h-11 rounded-xl-lg border border-[var(--color-border-subtle)] text-base">
                Skip
              </button>
            </div>

            {outcomeError && (
              <p className="mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{outcomeError}</p>
            )}
            <div className="border-t border-[var(--color-border-subtle)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-3 uppercase tracking-wider text-center">Record Outcome</h3>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={savingOutcome} onClick={() => handleQuickTap('no_answer')} className="bg-[var(--color-status-noanswer)]/20 text-[var(--color-status-noanswer)] border border-[var(--color-status-noanswer)]/30 font-medium min-h-11 rounded-xl">Not Home</button>
                <button disabled={savingOutcome} onClick={() => handleQuickTap('spoke')} className="bg-[var(--color-status-spoke)]/20 text-[var(--color-status-spoke)] border border-[var(--color-status-spoke)]/30 font-medium min-h-11 rounded-xl">Spoke</button>
                <button disabled={savingOutcome} onClick={() => handleQuickTap('interested')} className="bg-[var(--color-status-interested)]/20 text-[var(--color-status-interested)] border border-[var(--color-status-interested)]/30 font-medium min-h-11 rounded-xl">Interested</button>
                <button disabled={savingOutcome} onClick={() => handleQuickTap('appointment_set')} className="bg-[var(--color-status-appointment)]/20 text-[var(--color-status-appointment)] border border-[var(--color-status-appointment)]/30 font-medium min-h-11 rounded-xl">Appointment</button>
                <button disabled={savingOutcome} onClick={() => handleQuickTap('not_interested')} className="bg-[var(--color-status-lost)]/20 text-[var(--color-status-lost)] border border-[var(--color-status-lost)]/30 font-medium min-h-11 rounded-xl">Not Interested</button>
                <button disabled={savingOutcome} onClick={() => handleQuickTap('do_not_knock')} className="bg-[var(--color-status-dnc)]/40 text-[var(--color-text-disabled)] border border-[var(--color-status-dnc)] border-solid border font-medium min-h-11 rounded-xl">Do Not Contact</button>
              </div>
            </div>
          </div>
        )}

        {outcomeFlow === 'spoke' && (
          <div className="bg-[var(--color-bg-card)] rounded-xl p-5 border border-[var(--color-border-strong)] flex flex-col h-full animate-in slide-in-from-right">
            <button onClick={() => setOutcomeFlow('none')} className="text-[var(--color-text-muted)] mb-4 text-sm flex items-center">
               <X size={16} className="mr-1" /> Cancel
            </button>
            <h2 className="text-xl font-bold mb-4 text-[var(--color-status-spoke)]">You spoke to them!</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">Capture their info (optional) before advancing.</p>
            
            <label className="block mb-4">
              <span className="text-xs text-[var(--color-text-muted)] uppercase">Name</span>
              <input type="text" value={spokeName} onChange={e => setSpokeName(e.target.value)} className="w-full mt-1 bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] rounded p-3 text-white" placeholder="e.g. Jane Doe" />
            </label>
            
            <label className="block mb-6">
              <span className="text-xs text-[var(--color-text-muted)] uppercase">Phone Number</span>
              <input type="tel" value={spokePhone} onChange={e => setSpokePhone(e.target.value)} className="w-full mt-1 bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] rounded p-3 text-white" placeholder="(555) 555-5555" />
            </label>

            <div className="mt-auto pt-4 flex gap-3">
               <button disabled={savingOutcome} onClick={handleSpokeSave} className="flex-1 disabled:opacity-50 bg-[var(--color-brand-primary)] text-white font-bold min-h-12 rounded-xl-lg shadow flex justify-center items-center gap-2">
                 Save & Advance <ChevronRight size={18} />
               </button>
            </div>
          </div>
        )}

        {outcomeFlow === 'appointment' && (
          <div className="bg-[var(--color-bg-card)] rounded-xl p-5 border border-[var(--color-border-strong)] flex flex-col h-full animate-in slide-in-from-right">
            <button onClick={() => setOutcomeFlow('none')} className="text-[var(--color-text-muted)] mb-4 text-sm flex items-center">
               <X size={16} className="mr-1" /> Cancel
            </button>
            <h2 className="text-xl font-bold mb-2 text-[var(--color-status-appointment)] flex items-center gap-2"><Calendar size={20} /> Fast Scheduler</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">{currentLead.address}</p>

            <div className="mb-6">
              <label className="block">
                <span className="text-xs text-[var(--color-text-muted)] uppercase">Appointment date & time</span>
                <input
                  type="datetime-local"
                  value={apptSlot}
                  onChange={(e) => setApptSlot(e.target.value)}
                  className="w-full mt-1 bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] rounded p-3 text-white"
                />
              </label>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Choose the time agreed with the homeowner. This screen does not invent or imply office availability.
              </p>
            </div>

            <div className="border-t border-[var(--color-border-subtle)] pt-4 mb-4">
              <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-3 uppercase">Contact Info</h3>
              <label className="block mb-3">
                <input type="text" value={spokeName} onChange={e => setSpokeName(e.target.value)} className="w-full bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] rounded p-3 text-white text-sm" placeholder="Contact Name" />
              </label>
              <label className="block mb-3">
                <input type="tel" value={spokePhone} onChange={e => setSpokePhone(e.target.value)} className="w-full bg-[var(--color-bg-app)] border border-[var(--color-border-subtle)] rounded p-3 text-white text-sm" placeholder="Phone Number" />
              </label>
            </div>

            <div className="mt-auto flex gap-3">
               <button onClick={handleApptSave} disabled={!apptSlot || savingOutcome} className="flex-1 bg-[var(--color-brand-primary)] disabled:opacity-50 text-white font-bold min-h-12 rounded-xl-lg shadow flex justify-center items-center gap-2">
                 Schedule & Advance <ChevronRight size={18} />
               </button>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
