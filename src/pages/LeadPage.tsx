import { useCallback, useEffect, useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LeadNotePanel from '@/components/LeadNotePanel'
import { evidenceFor } from '@/features/routes/knock-evidence'
import { openSessionId } from '@/features/routes/route-store'
import { mayCallAt } from '@/features/compliance/engine'
import { ALL_SOLICITATION_RULES } from '@/features/compliance/solicitation'
import { Button, Card, Empty, Field, SectionTitle, TextInput } from '@/components/ui'
import DocumentCenter from '@/features/documents/DocumentCenter'
import ContactActions from '@/components/ContactActions'
import NextBestActionPanel from '@/components/NextBestActionPanel'
import { ConversationTimeline } from '@/features/leads/ConversationTimeline'
import RoofrPanel from '@/features/integrations/roofr/RoofrPanel'
import IntegrityPanel from '@/features/leads/IntegrityPanel'
import { readLink } from '@/features/integrations/roofr/store'
import { pendingWork } from '@/lib/sync'
import {
  addEvent,
  listAttachments,
  readHistory,
  readLead,
  saveLead,
  saveOutcome,
  type LeadAttachment,
} from '@/features/leads/lead-store'
import {
  applyOutcome,
  CHANNEL_LABEL,
  CONTACT_SOURCE_LABEL,
  contactSourceOf,
  isFromHomeowner,
  mayContact,
  optOut,
  OUTCOME_LABEL,
  setConsent,
  setContact,
  STATUS_LABEL,
  type ContactChannel,
  type ContactEvent,
  type ContactKind,
  type ContactSource,
  type DoorOutcome,
  type ManagedLead,
} from '@/features/leads/pipeline'
import { newId, saveInspection, type LocalInspection } from '@/lib/db'

import RoofImageryPanel from '@/features/imagery/RoofImageryPanel'
import { buildPropertyProfile, type PropertyProfile } from '@/features/leads/property-profile'
import { distanceMiles } from '@/features/leads/scoring'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import { streetLineOf } from '@/integrations/geocode/ebr'
import type { PermitRecord } from '@/integrations/permits/types'

const QUICK: DoorOutcome[] = ['no_answer', 'come_back', 'interested', 'appointment_set']

const NUMBER_SOURCES: readonly ContactSource[] = [
  'homeowner_at_door',
  'homeowner_by_phone',
  'homeowner_in_writing',
  'public_record',
  'third_party_lookup',
]

const CHANNELS: ContactChannel[] = ['call', 'sms', 'email']

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toIso(local: string): string | undefined {
  if (local === '') return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

import { Bot } from 'lucide-react'


type TabID = 'overview' | 'homeowner_contact' | 'property' | 'permits_roof_age' | 'storm_history' | 'communications' | 'visits' | 'appointments' | 'inspections' | 'eagleview' | 'estimate' | 'proposal' | 'insurance' | 'documents' | 'ai_intelligence' | 'audit'

type PrimaryTabID = 'overview' | 'contact' | 'property' | 'sales' | 'more'

const PRIMARY_TABS: { id: PrimaryTabID, label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'contact', label: 'CONTACT' },
  { id: 'property', label: 'PROPERTY' },
  { id: 'sales', label: 'SALES' },
  { id: 'more', label: 'MORE' },
]

const SUB_TABS: Record<PrimaryTabID, { id: TabID, label: string }[]> = {
  overview: [],
  contact: [
    { id: 'homeowner_contact', label: 'Homeowner' },
    { id: 'communications', label: 'Communications' },
    { id: 'visits', label: 'Visits' },
  ],
  property: [
    { id: 'property', label: 'Details' },
    { id: 'permits_roof_age', label: 'Permits & Roof Age' },
    { id: 'storm_history', label: 'Storm History' },
  ],
  sales: [
    { id: 'appointments', label: 'Appointments' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'estimate', label: 'Estimate' },
  ],
  more: [
    { id: 'ai_intelligence', label: 'AI Intelligence' },
    { id: 'documents', label: 'Documents' },
    { id: 'audit', label: 'Audit Log' },
  ],
}

export default function LeadPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTabID>('overview')
  const [activeTab, setActiveTab] = useState<TabID>('overview')

  const [lead, setLead] = useState<ManagedLead | null>(null)
  const [editingNumber, setEditingNumber] = useState(false)
  const [newNumber, setNewNumber] = useState('')
  const [numberSource, setNumberSource] = useState<ContactSource | null>(null)
  const [history, setHistory] = useState<ContactEvent[]>([])
  const [attachments, setAttachments] = useState<LeadAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [reschedule, setReschedule] = useState('')

  const [roofrJobId, setRoofrJobId] = useState<string | null>(null)
  const [roofrLastEventAt, setRoofrLastEventAt] = useState<string | null>(null)

  const [queued, setQueued] = useState<{ total: number; stalled: number }>({ total: 0, stalled: 0 })
  const [run, setRun] = useState<LeadRun | null>(null)
  const [permits, setPermits] = useState<PermitRecord[] | null>(null)
  const [profile, setProfile] = useState<PropertyProfile | null>(null)

  const [inspections, setInspections] = useState<Array<{ id: string, created_at?: string, createdAt?: string, status?: string }>>([])
  const [appointments, setAppointments] = useState<Array<{ id: string, scheduled_for?: string, created_at?: string, status?: string, notes?: string }>>([])
  const [communications, setCommunications] = useState<Array<{ id: string, created_at: string, type?: string, notes?: string }>>([])

  useEffect(() => {
    void readCachedRun().then(setRun)
  }, [])

  useEffect(() => {
    if (lead) {
      new EbrPermitProvider().search({
        kinds: ['reroof', 'new_build', 'other'],
        addressLike: streetLineOf(lead.address),
        limit: 100,
      }).then(setPermits).catch(() => setPermits([]))
    }
  }, [lead])

  const scoredLead = useMemo(() => {
    return run?.leads.find((l) => l.addressKey === lead?.addressKey)
  }, [run, lead])

  useEffect(() => {
    if (lead && permits && run && scoredLead) {
      const nearby = (run.stormEvents ?? []).filter(
        (s) => distanceMiles(lead.latitude, lead.longitude, s.latitude, s.longitude) <= 5,
      )
      setProfile(buildPropertyProfile({
        address: lead.address,
        addressKey: lead.addressKey,
        ...(scoredLead.parcel ? { parcel: scoredLead.parcel } : {}),
        permits,
        storms: nearby,
        now: new Date(),
      }))
    }
  }, [lead, permits, run, scoredLead])

  const load = useCallback(async (leadId: string) => {
    const [localFound, events, files] = await Promise.all([
      readLead(leadId),
      readHistory(leadId),
      listAttachments(leadId),
    ])
    
    let found = localFound
    if (!found) {
      const { getSupabase } = await import('@/lib/supabase')
      const supa = getSupabase()
      if (supa) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
        if (isUUID) {
          const { data: leadData } = await supa.from('leads').select('*, properties(*)').eq('id', leadId).maybeSingle();
          if (leadData && leadData.properties) {
            found = {
              id: leadData.id,
              addressKey: leadData.properties.normalized_address,
              address: leadData.properties.address_line1,
              latitude: leadData.properties.latitude,
              longitude: leadData.properties.longitude,
              status: leadData.status || 'new',
              reasons: leadData.reasons || [],
              score: leadData.score || 0,
              createdAt: leadData.created_at || new Date().toISOString(),
              updatedAt: leadData.updated_at || new Date().toISOString(),
              knockCount: leadData.knock_count || 0
            } as ManagedLead;
          } else {
            const { data: pData } = await supa.from('properties').select('*, leads(*)').eq('id', leadId).maybeSingle();
            if (pData) {
              const l = pData.leads?.[0];
              found = {
                id: l?.id || pData.id,
                addressKey: pData.normalized_address,
                address: pData.address_line1,
                latitude: pData.latitude,
                longitude: pData.longitude,
                status: l?.status || 'new',
                reasons: l?.reasons || [],
                score: l?.score || 0,
                createdAt: l?.created_at || new Date().toISOString(),
                updatedAt: l?.updated_at || new Date().toISOString(),
                knockCount: l?.knock_count || 0
              } as ManagedLead;
            }
          }
        } else {
          // Fallback backward compatibility redirect
          const { data } = await supa.from('properties').select('*, leads(*)').eq('normalized_address', decodeURIComponent(leadId)).maybeSingle();
          if (data) {
            const canonicalId = data.leads?.[0]?.id || data.id;
            navigate(`/leads/${canonicalId}`, { replace: true });
            return;
          }
        }
      }
    }

    if (found) {
      const { getSupabase } = await import('@/lib/supabase')
      const supa = getSupabase()
      if (supa) {
        supa.from('inspections').select('*').eq('lead_id', found.id).then(({ data }) => setInspections(data || []))
        supa.from('appointments').select('*').eq('lead_id', found.id).then(({ data }) => setAppointments(data || []))
        supa.from('communications').select('*').eq('lead_id', found.id).then(({ data }) => setCommunications(data || []))
      }
    }

    setLead(found)
    setHistory(events)
    setAttachments(files)
    setLoading(false)

    void readLink(leadId).then((link) => {
      setRoofrJobId(link?.roofrJobId ?? null)
      setRoofrLastEventAt(link?.lastEventAt ?? null)
    })
    void pendingWork().then((work) =>
      setQueued({ total: work.total, stalled: work.stalled }),
    )
  }, [navigate])

  useEffect(() => {
    if (id) void load(id)
    else setLoading(false)
  }, [id, load])

  const record = useCallback(
    async (outcome: DoorOutcome) => {
      if (!lead) return
      const at = new Date().toISOString()
      const gps = await evidenceFor(lead)
      const routeSessionId = await openSessionId()
      const { lead: next, event } = applyOutcome(lead, outcome, at, {
        gps,
        ...(routeSessionId !== undefined ? { routeSessionId } : {}),
      })
      await saveOutcome(next, event)
      await load(lead.id)
    },
    [lead, load],
  )

  const logAttempt = useCallback(
    async (kind: ContactKind) => {
      if (!lead) return
      const at = new Date().toISOString()
      await addEvent({ id: newId(), leadId: lead.id, at, kind })
      await load(lead.id)
    },
    [lead, load],
  )

  const addNote = useCallback(
    async (body: string): Promise<string> => {
      if (!lead) throw new Error('no lead')
      const at = new Date().toISOString()
      const eventId = newId()
      await addEvent({ id: eventId, leadId: lead.id, at, kind: 'note', note: body })
      await load(lead.id)
      return eventId
    },
    [lead, load],
  )

  const toggleConsent = useCallback(
    async (channel: ContactChannel, granted: boolean) => {
      if (!lead) return
      const at = new Date().toISOString()
      await saveLead(setConsent(lead, channel, granted, at))
      await addEvent({
        id: newId(),
        leadId: lead.id,
        at,
        kind: 'note',
        note: granted
          ? `Said we may contact them by ${CHANNEL_LABEL[channel].toLowerCase()}.`
          : `Permission to contact by ${CHANNEL_LABEL[channel].toLowerCase()} removed.`,
      })
      await load(lead.id)
    },
    [lead, load],
  )

  const stopContacting = useCallback(async () => {
    if (!lead) return
    const at = new Date().toISOString()
    await saveLead(optOut(lead, at))
    await addEvent({
      id: newId(),
      leadId: lead.id,
      at,
      kind: 'note',
      note: 'Asked not to be contacted. All permissions cleared.',
    })
    await load(lead.id)
  }, [lead, load])

  const saveNumber = useCallback(async () => {
    if (!lead || newNumber.trim() === '' || numberSource === null) return
    const at = new Date().toISOString()
    const next = setContact(lead, { phone: newNumber.trim(), source: numberSource }, at)
    await saveLead(next)
    await addEvent({
      id: newId(),
      leadId: lead.id,
      at,
      kind: 'note',
      note: `Phone number recorded — ${CONTACT_SOURCE_LABEL[numberSource].toLowerCase()}.`,
    })
    setNewNumber('')
    setNumberSource(null)
    setEditingNumber(false)
    await load(lead.id)
  }, [lead, newNumber, numberSource, load])

  const moveNextAction = useCallback(async () => {
    const at = toIso(reschedule)
    if (!lead || at === undefined) return
    await saveLead({ ...lead, nextActionAt: at, updatedAt: new Date().toISOString() })
    setReschedule('')
    await load(lead.id)
  }, [lead, reschedule, load])

  const inspect = useCallback(async () => {
    if (!lead) return
    const at = new Date().toISOString()
    const inspection: LocalInspection = {
      id: newId(),
      createdAt: at,
      updatedAt: at,
      status: 'in_progress',
      addressLine1: lead.address,
      propertyType: 'residential',
      roofMaterial: 'asphalt_shingle',
      syncState: 'local',
      latitude: lead.latitude,
      longitude: lead.longitude,
      ...(lead.city ? { city: lead.city } : {}),
      ...(lead.postalCode ? { postalCode: lead.postalCode } : {}),
      ...(lead.contactName ? { customerFirstName: lead.contactName } : {}),
      ...(lead.contactPhone ? { customerPhone: lead.contactPhone } : {}),
    }
    await saveInspection(inspection)
    const routeSessionId = await openSessionId()
    const { lead: next, event } = applyOutcome(lead, 'inspect_now', at, {
      inspectionId: inspection.id,
      ...(routeSessionId !== undefined ? { routeSessionId } : {}),
    })
    await saveOutcome(next, event)
    navigate(`/inspection/${inspection.id}`)
  }, [lead, navigate])

  if (loading) {
    return <p className="py-16 text-center text-[13px] text-text-secondary">Loading…</p>
  }

  if (!lead) {
    return (
      <Empty
        title="No such lead"
        body="It may have been captured on another device and not pushed yet, or captured while signed out. A lead reaches the office on the next sync, not the moment it is written."
      />
    )
  }

  const callBlock = mayContact(lead, 'call')
  const smsBlock = mayContact(lead, 'sms')
  const phoneSource = contactSourceOf(lead)

  const callWindow = mayCallAt(
    ALL_SOLICITATION_RULES,
    { state: 'LA', parish: 'East Baton Rouge', municipality: null },
    new Date(),
  )
  const blockReason = !callBlock.allowed
    ? callBlock.reason
    : !smsBlock.allowed
      ? smsBlock.reason
      : null

  const handleOutcomeClick = () => {
    setActivePrimaryTab('contact')
    setActiveTab('visits')
    setTimeout(() => {
      document.getElementById('outcome-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  return (
    <div className="pb-24">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-bg-app/95 backdrop-blur-md border-b border-border-subtle px-4 pt-4 pb-0 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-brand-500 font-bold mb-1">
              {STATUS_LABEL[lead.status]}
            </p>
            <h1 className="font-display text-xl leading-tight tracking-wide truncate">
              {lead.contactName ?? lead.address}
            </h1>
            {lead.contactName && (
              <p className="text-[12.5px] text-text-secondary truncate mt-0.5">{lead.address}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Button variant="primary" onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(lead.address)}`)}>Navigate</Button>
            <Button variant="secondary" onClick={handleOutcomeClick}>Outcome</Button>
          </div>
        </div>
        
        <div className="mt-4 -mx-4 px-4 overflow-x-auto no-scrollbar flex gap-4">
          {PRIMARY_TABS.map(pt => (
            <button 
              key={pt.id} 
              onClick={() => {
                setActivePrimaryTab(pt.id)
                const firstSub = SUB_TABS[pt.id][0]
                if (firstSub) {
                  setActiveTab(firstSub.id)
                } else {
                  setActiveTab('overview')
                }
              }} 
              className={`pb-3 text-[12px] whitespace-nowrap font-bold uppercase tracking-wider border-b-2 transition-colors ${activePrimaryTab === pt.id ? 'border-brand-500 text-brand-500' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            >
              {pt.label}
            </button>
          ))}
        </div>
        {SUB_TABS[activePrimaryTab].length > 0 && (
          <div className="-mx-4 px-4 py-2 bg-bg-elevated/50 overflow-x-auto no-scrollbar flex gap-3 border-b border-border-subtle">
            {SUB_TABS[activePrimaryTab].map(st => (
              <button
                key={st.id}
                onClick={() => setActiveTab(st.id)}
                className={`px-3 py-1.5 rounded-full text-[11.5px] whitespace-nowrap font-medium transition-colors ${activeTab === st.id ? 'bg-brand-500 text-white shadow-sm' : 'bg-transparent text-text-secondary hover:bg-bg-app hover:text-text-primary'}`}
              >
                {st.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="p-4 space-y-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <NextBestActionPanel lead={lead} />
            
            <SectionTitle>NOTES</SectionTitle>
            <LeadNotePanel leadId={lead.id} onSaved={addNote} />

            {lead.status === 'inspected' && (
              <>
                <SectionTitle>REFERRAL GENERATOR</SectionTitle>
                <Card className="border-l-4 border-l-brand-400 bg-brand-primary/5">
                  <h3 className="text-[13px] font-bold text-text-primary">1-Tap Referral Request</h3>
                  <p className="text-[11px] text-text-secondary mt-1 mb-3">Send a personalized SMS with their unique referral link. They earn $250 per closed referral.</p>
                  <div className="flex gap-2">
                    <Button variant="gold" full onClick={() => void logAttempt('text_initiated')}>Send Referral SMS</Button>
                    <Button variant="secondary" full onClick={() => navigator.clipboard.writeText('https://deltaridge.com/ref/' + lead.id)}>Copy Link</Button>
                  </div>
                </Card>
              </>
            )}

            <SectionTitle>WHY IT WAS ON THE LIST</SectionTitle>
            <Card>
              <ul className="space-y-1">
                {lead.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-text-secondary">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
                Priority {lead.score} as it stood when you knocked. It is kept as it was, not recomputed,
                so this still says what you were looking at that day.
              </p>
            </Card>
          </div>
        )}

        {activeTab === 'homeowner_contact' && (
          <div className="space-y-6">
            <ContactActions
              phone={lead.contactPhone ?? null}
              phoneNote={phoneSource === null ? null : CONTACT_SOURCE_LABEL[phoneSource]}
              email={null}
              latitude={lead.latitude}
              longitude={lead.longitude}
              call={{
                allowed: callBlock.allowed && callWindow.allowed,
                reason: !callBlock.allowed
                  ? callBlock.reason
                  : !callWindow.allowed
                    ? (callWindow.reasons[0] ?? 'Outside the calling window')
                    : null,
              }}
              text={{
                allowed: smsBlock.allowed && callWindow.allowed,
                reason: !smsBlock.allowed
                  ? smsBlock.reason
                  : !callWindow.allowed
                    ? (callWindow.reasons[0] ?? 'Outside the calling window')
                    : null,
              }}
              onCall={() => void logAttempt('call_placed')}
              onText={() => void logAttempt('text_initiated')}
            />

            <SectionTitle>REACH THEM</SectionTitle>
            <Card>
              {lead.contactPhone ? (
                <>
                  <p className="text-[15px] font-semibold">{lead.contactPhone}</p>
                  {phoneSource && (
                    <p
                      className={`mt-0.5 text-[11.5px] ${
                        isFromHomeowner(phoneSource) ? 'text-text-secondary' : 'text-warning-highlight/70'
                      }`}
                    >
                      {CONTACT_SOURCE_LABEL[phoneSource]}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-text-secondary">No phone number on this lead.</p>
              )}

              {!callWindow.allowed && lead.contactPhone && (
                <div className="mt-2 rounded-xl bg-warning-surface px-3 py-2 ring-1 ring-warning-border">
                  {callWindow.reasons.map((reason) => (
                    <p key={reason} className="text-[12px] leading-relaxed text-warning-highlight/80">
                      {reason}
                    </p>
                  ))}
                </div>
              )}

              <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                {callBlock.allowed && callWindow.allowed && lead.contactPhone ? (
                  <a href={`tel:${lead.contactPhone}`} className="contents">
                    <Button variant="secondary" onClick={() => void logAttempt('call_placed')}>
                      Call
                    </Button>
                  </a>
                ) : (
                  <Button variant="secondary" disabled>
                    Call
                  </Button>
                )}
                {smsBlock.allowed && callWindow.allowed && lead.contactPhone ? (
                  <a href={`sms:${lead.contactPhone}`} className="contents">
                    <Button variant="secondary" onClick={() => void logAttempt('text_initiated')}>
                      Text
                    </Button>
                  </a>
                ) : (
                  <Button variant="secondary" disabled>
                    Text
                  </Button>
                )}
              </div>

              {blockReason && (
                <p className="mt-2 text-[12px] leading-relaxed text-warning-highlight/80">{blockReason}</p>
              )}

              <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
                Recorded as placed and initiated. The app hands the number to your phone and cannot see
                whether it was answered or delivered, so it does not say that it was.
              </p>
              {editingNumber ? (
                <div className="mt-3 border-t border-border-subtle pt-3">
                  <Field label="Number">
                    <TextInput
                      type="tel"
                      value={newNumber}
                      onChange={(e) => setNewNumber(e.target.value)}
                      placeholder="225…"
                    />
                  </Field>
                  <p className="mt-3 text-[11.5px] font-medium text-text-secondary">Where did it come from?</p>
                  <div className="mt-2 space-y-1.5">
                    {NUMBER_SOURCES.map((source) => (
                      <button
                         key={source}
                        onClick={() => setNumberSource(source)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left ring-1 ${
                          numberSource === source
                            ? 'bg-gold-500/15 ring-gold-400/40'
                            : 'bg-bg-page hover:bg-bg-elevated ring-border-subtle'
                        }`}
                      >
                        <span className="text-[13px]">{CONTACT_SOURCE_LABEL[source]}</span>
                        {!isFromHomeowner(source) && (
                          <span className="text-[10.5px] text-warning-highlight/70">not dialable here</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
                    A number they did not hand over is stored and shown, and the call and text buttons
                    stay off for it. Confirm it with them and record it again to change that.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <Button variant="secondary" onClick={() => setEditingNumber(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="gold"
                      disabled={newNumber.trim() === '' || numberSource === null}
                      onClick={() => void saveNumber()}
                    >
                      {numberSource === null ? 'Pick a source' : 'Save number'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" full className="mt-2" onClick={() => setEditingNumber(true)}>
                  {lead.contactPhone ? 'Change the number' : 'Add a number'}
                </Button>
              )}

              {callWindow.allowed && callWindow.requires.length > 0 && (
                <p className="mt-1 text-[10.5px] leading-relaxed text-text-secondary">
                  The hour is allowed. It does not clear the number — the state and national do-not-call
                  lists are screened outside this app, and legal holidays are not in it.
                </p>
              )}
            </Card>

            <SectionTitle>PERMISSION</SectionTitle>
            <Card>
              {lead.optedOutAt ? (
                <p className="text-[12.5px] leading-relaxed text-warning-highlight/90">
                  They asked not to be contacted, on {when(lead.optedOutAt)}. Every permission on this
                  lead was cleared at the same time, and this cannot be undone from the field.
                </p>
              ) : (
                <>
                  <p className="text-[11.5px] leading-relaxed text-text-secondary">
                    Tick only what they actually said you could do. Having their number is not permission
                    to use it.
                  </p>
                  <div className="mt-3 space-y-2">
                    {CHANNELS.map((channel) => {
                      const granted = lead.consent?.[channel] !== undefined
                      return (
                        <button
                          key={channel}
                          onClick={() => void toggleConsent(channel, !granted)}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left ring-1 ${
                            granted
                              ? 'bg-status-success/12 ring-emerald-400/25'
                              : 'bg-bg-page hover:bg-bg-elevated ring-border-subtle'
                          }`}
                        >
                          <span className="text-[13px] text-text-secondary">{CHANNEL_LABEL[channel]}</span>
                          <span
                            className={`text-[11px] uppercase tracking-wider ${
                              granted ? 'text-status-success' : 'text-text-secondary'
                            }`}
                          >
                            {granted ? 'said yes' : 'not asked'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <Button variant="danger" full className="mt-3" onClick={() => void stopContacting()}>
                    They asked us to stop
                  </Button>
                </>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'property' && (
          <div className="space-y-6">
            <SectionTitle>PROPERTY & IMAGERY</SectionTitle>
            <RoofImageryPanel
              latitude={lead.latitude}
              longitude={lead.longitude}
              storms={profile?.storms ?? []}
              autoFetch
            />
          </div>
        )}

        {activeTab === 'permits_roof_age' && (
          <div className="space-y-6">
            <SectionTitle>PERMITS & ROOF AGE</SectionTitle>
            <Card>
              {permits && permits.length > 0 ? (
                permits.map(p => (
                  <div key={p.externalId} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
                    <p className="font-semibold text-text-primary text-[13px]">{p.issuedAt.slice(0, 10)} - {p.kind}</p>
                    <p className="text-[12px] text-text-secondary">{p.externalId}</p>
                  </div>
                ))
              ) : (
                <Empty title="No permits found" body="No roofing or building permits found in the public database." />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'storm_history' && (
          <div className="space-y-6">
            <SectionTitle>STORM IMPACT DETAILS</SectionTitle>
            <Card>
              {profile?.storms && profile.storms.length > 0 ? (
                profile.storms.map(s => (
                  <div key={s.externalId} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
                    <p className="font-semibold text-text-primary text-[13px]">{new Date(s.occurredAt).toLocaleDateString()} - {s.hailSizeInches ? `${s.hailSizeInches}" Hail` : `${s.windSpeedMph} MPH Wind`}</p>
                    <p className="text-[12px] text-text-secondary">{s.city}, {s.countyParish} - {s.observation}</p>
                  </div>
                ))
              ) : (
                <Empty title="No storms" body="No storm data found for this property." />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'communications' && (
          <div className="space-y-6">
            <SectionTitle>UNIVERSAL TIMELINE</SectionTitle>
            <ConversationTimeline leadId={lead.id} />
            <SectionTitle>COMMUNICATIONS LOG</SectionTitle>
            <Card>
              {communications.length > 0 ? (
                communications.map(c => (
                  <div key={c.id} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
                    <p className="font-semibold text-text-primary text-[13px]">{new Date(c.created_at).toLocaleDateString()} - {c.type}</p>
                    <p className="text-[12px] text-text-secondary">{c.notes}</p>
                  </div>
                ))
              ) : (
                <Empty title="No communications" body="No communications recorded for this lead." />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'visits' && (
          <div className="space-y-6">
            <SectionTitle>WHAT HAPPENED</SectionTitle>
            <Card id="outcome-section" className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              {QUICK.map((outcome) => (
                <Button key={outcome} variant="secondary" onClick={() => void record(outcome)}>
                  {OUTCOME_LABEL[outcome]}
                </Button>
              ))}
              <Button variant="secondary" onClick={() => void record('not_interested')}>
                Not interested
              </Button>
              <Button variant="danger" onClick={() => void record('do_not_knock')}>
                Do not knock
              </Button>
            </Card>

            <SectionTitle>NEXT VISIT</SectionTitle>
            <Card>
              <Field label="Come back at">
                <TextInput
                  type="datetime-local"
                  value={reschedule}
                  onChange={(e) => setReschedule(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                full
                className="mt-3"
                onClick={() => void moveNextAction()}
                disabled={toIso(reschedule) === undefined}
              >
                Move the follow-up
              </Button>
            </Card>
          </div>
        )}

        {activeTab === 'appointments' && (
          <div className="space-y-6">
            <SectionTitle>APPOINTMENTS</SectionTitle>
            <Card>
              {appointments.length > 0 ? (
                appointments.map(a => (
                  <div key={a.id} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
                    <p className="font-semibold text-text-primary text-[13px]">{new Date(a.scheduled_for || a.created_at || "").toLocaleDateString()} - {a.status}</p>
                    <p className="text-[12px] text-text-secondary">{a.notes}</p>
                  </div>
                ))
              ) : (
                <Empty title="No appointments" body="No appointments scheduled." />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'inspections' && (
          <div className="space-y-6">
            <Button variant="gold" full onClick={() => void inspect()}>
               Inspect this roof
            </Button>
            <Card>
              <h3 className="text-sm font-semibold mb-2">Inspection History</h3>
              {inspections.length > 0 ? (
                inspections.map(i => (
                  <div key={i.id} className="border-t border-border-subtle py-2 first:border-t-0 first:pt-0">
                    <p className="font-semibold text-text-primary text-[13px]">{new Date(i.created_at || i.createdAt || "").toLocaleDateString()} - {i.status}</p>
                  </div>
                ))
              ) : (
                <Empty title="No inspections" body="No inspection reports found." />
              )}
            </Card>
          </div>
        )}

        {activeTab === 'estimate' && (
          <div className="space-y-6">
            <RoofrPanel leadId={lead.id} />
          </div>
        )}

        {activeTab === 'proposal' && (
          <div className="space-y-6">
            <ProposalOptionsPanel />
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-6">
            <SectionTitle>DOCUMENT CENTER</SectionTitle>
            <DocumentCenter leadId={lead.id}  />
          </div>
        )}

        {activeTab === 'ai_intelligence' && (
          <div className="space-y-6">
            <SectionTitle>OPPORTUNITY SUMMARY</SectionTitle>
            <Card className="border-l-4 border-l-brand-400 bg-brand-primary/5">
              <div className="flex gap-2 items-center mb-2">
                <Bot size={24} className="text-brand-400" />
                <h3 className="text-[13px] font-bold text-text-primary">Claude Analysis</h3>
              </div>
              <p className="text-[12.5px] text-text-secondary whitespace-pre-wrap">
                {/* Note: In a full app, we'd add 'opportunitySummary' to the ManagedLead type. Using raw property access for now if it were present. */}
                No AI summary has been generated for this property yet. Run the Property Enrichment pipeline to populate this analysis.
              </p>
            </Card>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-6">
            <IntegrityPanel
              evidence={{
                address: lead.address,
                phoneSource: lead.contactPhone === undefined ? null : (contactSourceOf(lead) ?? null),
                hasEmail: false,
                callConsentAt: lead.consent?.call?.at ?? null,
                smsConsentAt: lead.consent?.sms?.at ?? null,
                callWindowRuleIds: callWindow.ruleIds,
                optedOut: lead.optedOutAt !== undefined,
                stormSource: null,
                stormEventAt: null,
                imageryCapturedAt: null,
                gpsVerifiedKnocks: history.filter((e) => e.gps?.verification === 'verified').length,
                totalKnocks: history.filter((e) => e.gps !== undefined).length,
                voiceNotes: attachments.filter((a) => a.kind === 'voice').length,
                voiceNotesTranscribed: 0,
                roofrJobId,
                roofrLastEventAt,
                pendingSyncItems: queued.total,
                failedSyncItems: queued.stalled,
                now: new Date().toISOString(),
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}









