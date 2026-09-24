import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import LeadNotePanel from '@/components/LeadNotePanel'
import { evidenceFor } from '@/features/routes/knock-evidence'
import { mayCallAt } from '@/features/compliance/engine'
import { ALL_SOLICITATION_RULES } from '@/features/compliance/solicitation'
import { Button, Card, Empty, Field, SectionTitle, TextInput } from '@/components/ui'
import ContactActions from '@/components/ContactActions'
import RoofrPanel from '@/features/integrations/roofr/RoofrPanel'
import IntegrityPanel from '@/features/leads/IntegrityPanel'
import LeadPropertyIntelligence from '@/features/leads/LeadPropertyIntelligence'
import LeadContactIdentityPanel from '@/features/contacts/LeadContactIdentityPanel'
import LeadTimeline from '@/features/leads/LeadTimeline'
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
  dueLabel,
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
import { useSession } from '@/features/auth/session'
import DataHealthPanel from '@/features/leads/DataHealthPanel'
import { readLeadDataHealth } from '@/features/leads/data-health-store'
import type { DataHealthIssue, FixTarget } from '@/features/leads/data-health'

/**
 * One lead, everything said to it, and what to do next.
 *
 * The history is the point. A status on its own — "follow-up" — is a claim
 * with nothing behind it; a rep picking this up three weeks later needs to see
 * that somebody knocked twice, that the wife asked them to come back after
 * six, and that nobody has been since.
 *
 * Every line says exactly what the app witnessed. A call is recorded as
 * PLACED, never as answered, and a text as INITIATED, never as delivered,
 * because the device cannot know either.
 */

const QUICK: DoorOutcome[] = ['no_answer', 'come_back', 'interested', 'appointment_set']
/**
 * The sources a rep can pick, in the order they actually happen.
 *
 * 'unknown' is deliberately absent: it is a state a legacy row can be IN, not
 * an answer anybody should be able to choose. Offering it would make the
 * easiest option the one that records nothing.
 */
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

export default function LeadPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { membership } = useSession()
  const [lead, setLead] = useState<ManagedLead | null>(null)
  const [editingNumber, setEditingNumber] = useState(false)
  const [newNumber, setNewNumber] = useState('')
  const [numberSource, setNumberSource] = useState<ContactSource | null>(null)
  const [history, setHistory] = useState<ContactEvent[]>([])
  const [attachments, setAttachments] = useState<LeadAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [reschedule, setReschedule] = useState('')
  /*
   * Evidence the integrity panel needs that does not live on the lead itself.
   * Loaded separately and allowed to stay null: a slow or absent server must not
   * hold up the screen a rep is standing on a driveway to read.
   */
  const [roofrJobId, setRoofrJobId] = useState<string | null>(null)
  const [roofrLastEventAt, setRoofrLastEventAt] = useState<string | null>(null)
  const [queued, setQueued] = useState<{ total: number; stalled: number }>({ total: 0, stalled: 0 })
  const [healthIssues, setHealthIssues] = useState<DataHealthIssue[]>([])

  const load = useCallback(async (leadId: string) => {
    const [found, events, files] = await Promise.all([
      readLead(leadId),
      readHistory(leadId),
      listAttachments(leadId),
    ])
    setLead(found)
    setHistory(events)
    setAttachments(files)
    setLoading(false)

    // After the screen is usable, not before. Both of these can fail quietly;
    // the panel reads their absence as "not sent to Roofr" and "nothing queued",
    // which is what absence actually means here.
    void readLink(leadId).then((link) => {
      setRoofrJobId(link?.roofrJobId ?? null)
      setRoofrLastEventAt(link?.lastEventAt ?? null)
    })
    void pendingWork().then((work) =>
      setQueued({ total: work.total, stalled: work.stalled }),
    )
  }, [])

  useEffect(() => {
    if (id) void load(id)
    else setLoading(false)
  }, [id, load])

  useEffect(() => {
    if (!lead) {
      setHealthIssues([])
      return
    }
    let cancelled = false
    void readLeadDataHealth({
      lead,
      organizationId: membership?.organizationId ?? null,
      roofrJobId,
      roofrLastEventAt,
      pendingSyncItems: queued.total,
      failedSyncItems: queued.stalled,
    }).then((result) => {
      if (!cancelled) setHealthIssues(result)
    })
    return () => {
      cancelled = true
    }
  }, [
    lead,
    membership?.organizationId,
    queued.stalled,
    queued.total,
    roofrJobId,
    roofrLastEventAt,
  ])

  const fixHealthIssue = useCallback(
    (target: FixTarget) => {
      if (target === 'sync') {
        navigate('/diagnostics')
        return
      }
      const ids: Record<Exclude<FixTarget, 'sync'>, string> = {
        contact: 'lead-contact-identity',
        property: 'lead-property-intelligence',
        permission: 'lead-permission',
        timeline: 'lead-timeline',
        roofr: 'lead-roofr',
      }
      document.getElementById(ids[target])?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [navigate],
  )

  const record = useCallback(
    async (outcome: DoorOutcome) => {
      if (!lead) return
      const at = new Date().toISOString()
      const gps = await evidenceFor(lead)
      const { lead: next, event } = applyOutcome(lead, outcome, at, { gps })
      await saveOutcome(next, event)
      await load(lead.id)
    },
    [lead, load],
  )

  /**
   * Logs that a call or text was STARTED. The app hands the number to the
   * phone and loses sight of it there, so that is all it claims.
   */
  const logAttempt = useCallback(
    async (kind: ContactKind) => {
      if (!lead) return
      const at = new Date().toISOString()
      await addEvent({ id: newId(), leadId: lead.id, at, kind })
      await load(lead.id)
    },
    [lead, load],
  )

  /**
   * Writes the note and hands back its id, so the panel can file whatever it
   * recorded or photographed against the same entry.
   */
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
      // Filed as a note so permission has the same audit trail as everything
      // else said at the door. A consent nobody can point to is not a consent.
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

  /**
   * Records a number with where it came from.
   *
   * The source picker has no default and the save is refused without one. That
   * is the whole feature: a number that enters the record without somebody
   * saying how it got there is a number nobody can decide about later, and an
   * optional field would be blank on exactly the rows where it matters.
   */
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
    const { lead: next, event } = applyOutcome(lead, 'inspect_now', at, {
      inspectionId: inspection.id,
    })
    await saveOutcome(next, event)
    navigate(`/inspection/${inspection.id}`)
  }, [lead, navigate])

  if (loading) {
    return <p className="py-16 text-center text-[13px] text-white/40">Loading…</p>
  }

  if (!lead) {
    return (
      <Empty
        title="No such lead"
        body="It may have been captured on another device and not pushed yet, or captured while signed out. A lead reaches the office on the next sync, not the moment it is written."
      />
    )
  }

  const due = dueLabel(lead, new Date().toISOString())
  const callBlock = mayContact(lead, 'call')
  const smsBlock = mayContact(lead, 'sms')
  const phoneSource = contactSourceOf(lead)

  /*
   * Whether the CLOCK allows a call, separately from whether this person does.
   *
   * Louisiana is tighter than federal on both counts — 8pm rather than 9pm, and
   * nothing at all on a Sunday — and a rep who has spent Sunday afternoon
   * knocking is precisely the person about to reach for the phone at the wrong
   * moment. The window is computed rather than trained, because a poster on a
   * wall has never stopped anybody.
   */
  const window = mayCallAt(
    ALL_SOLICITATION_RULES,
    { state: 'LA', parish: 'East Baton Rouge', municipality: null },
    new Date(),
  )
  // Narrowed once, here, rather than inside the JSX: a discriminated union
  // does not survive being re-tested in a ternary branch.
  const blockReason = !callBlock.allowed
    ? callBlock.reason
    : !smsBlock.allowed
      ? smsBlock.reason
      : null

  return (
    <div>
      {/*
        Above everything. The call and text controls used to sit three
        screenfuls down, under year-built and permit history, which meant a rep
        on a driveway scrolled past property research to reach a phone number.
        The compliance gates are the same ones as before — this moved the
        buttons, it did not loosen them.
      */}
      <ContactActions
        phone={lead.contactPhone ?? null}
        phoneNote={phoneSource === null ? null : CONTACT_SOURCE_LABEL[phoneSource]}
        email={null}
        latitude={lead.latitude}
        longitude={lead.longitude}
        call={{
          allowed: callBlock.allowed && window.allowed,
          reason: !callBlock.allowed
            ? callBlock.reason
            : !window.allowed
              ? (window.reasons[0] ?? 'Outside the calling window')
              : null,
        }}
        text={{
          allowed: smsBlock.allowed && window.allowed,
          reason: !smsBlock.allowed
            ? smsBlock.reason
            : !window.allowed
              ? (window.reasons[0] ?? 'Outside the calling window')
              : null,
        }}
        onCall={() => void logAttempt('call_placed')}
        onText={() => void logAttempt('text_initiated')}
      />

      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 ring-1 ring-white/10">
        <p className="text-[11px] uppercase tracking-wider text-white/40">
          {STATUS_LABEL[lead.status]}
        </p>
        <p className="mt-1 font-display text-lg leading-tight tracking-wide">
          {lead.contactName ?? lead.address}
        </p>
        {lead.contactName && <p className="mt-1 text-[12.5px] text-white/50">{lead.address}</p>}
        <p className="mt-2 text-[12.5px] text-white/60">
          {due ?? 'Nothing scheduled'} · knocked {lead.knockCount}x
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="contents"
          >
            <Button variant="secondary">Navigate</Button>
          </a>
          <Button variant="gold" onClick={() => void inspect()}>
            Inspect this roof
          </Button>
        </div>
      </div>

      <div id="lead-contact-identity" className="scroll-mt-4">
        <LeadContactIdentityPanel lead={lead} />
      </div>

      <div id="lead-property-intelligence" className="scroll-mt-4">
        <LeadPropertyIntelligence lead={lead} />
      </div>

      <SectionTitle>REACH THEM</SectionTitle>
      <Card>
        {lead.contactPhone ? (
          <>
            <p className="text-[15px] font-semibold">{lead.contactPhone}</p>
            {phoneSource && (
              <p
                className={`mt-0.5 text-[11.5px] ${
                  isFromHomeowner(phoneSource) ? 'text-white/40' : 'text-amber-200/70'
                }`}
              >
                {CONTACT_SOURCE_LABEL[phoneSource]}
              </p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-white/45">No phone number on this lead.</p>
        )}

        {!window.allowed && lead.contactPhone && (
          <div className="mt-2 rounded-xl bg-amber-500/8 px-3 py-2 ring-1 ring-amber-500/20">
            {window.reasons.map((reason) => (
              <p key={reason} className="text-[12px] leading-relaxed text-amber-100/80">
                {reason}
              </p>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {callBlock.allowed && window.allowed && lead.contactPhone ? (
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
          {smsBlock.allowed && window.allowed && lead.contactPhone ? (
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
          <p className="mt-2 text-[12px] leading-relaxed text-amber-200/80">{blockReason}</p>
        )}

        <p className="mt-2 text-[10.5px] leading-relaxed text-white/25">
          Recorded as placed and initiated. The app hands the number to your phone and cannot see
          whether it was answered or delivered, so it does not say that it was.
        </p>
        {editingNumber ? (
          <div className="mt-3 border-t border-white/5 pt-3">
            <Field label="Number">
              <TextInput
                type="tel"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="225…"
              />
            </Field>
            <p className="mt-3 text-[11.5px] font-medium text-white/60">Where did it come from?</p>
            <div className="mt-2 space-y-1.5">
              {NUMBER_SOURCES.map((source) => (
                <button
                  key={source}
                  onClick={() => setNumberSource(source)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left ring-1 ${
                    numberSource === source
                      ? 'bg-gold-500/15 ring-gold-400/40'
                      : 'bg-white/5 ring-white/8'
                  }`}
                >
                  <span className="text-[13px]">{CONTACT_SOURCE_LABEL[source]}</span>
                  {!isFromHomeowner(source) && (
                    <span className="text-[10.5px] text-amber-200/70">not dialable here</span>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              A number they did not hand over is stored and shown, and the call and text buttons
              stay off for it. Confirm it with them and record it again to change that.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
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

        {window.allowed && window.requires.length > 0 && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-white/25">
            The hour is allowed. It does not clear the number — the state and national do-not-call
            lists are screened outside this app, and legal holidays are not in it.
          </p>
        )}
      </Card>

      <div id="lead-permission" className="scroll-mt-4">
      <SectionTitle>PERMISSION</SectionTitle>
      <Card>
        {lead.optedOutAt ? (
          <p className="text-[12.5px] leading-relaxed text-amber-200/90">
            They asked not to be contacted, on {when(lead.optedOutAt)}. Every permission on this
            lead was cleared at the same time, and this cannot be undone from the field.
          </p>
        ) : (
          <>
            <p className="text-[11.5px] leading-relaxed text-white/45">
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
                        ? 'bg-emerald-500/12 ring-emerald-400/25'
                        : 'bg-white/5 ring-white/8'
                    }`}
                  >
                    <span className="text-[13px] text-white/80">{CHANNEL_LABEL[channel]}</span>
                    <span
                      className={`text-[11px] uppercase tracking-wider ${
                        granted ? 'text-emerald-300' : 'text-white/30'
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
      <SectionTitle>WHAT HAPPENED</SectionTitle>
      <Card className="grid grid-cols-2 gap-2">
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

      <SectionTitle>NOTES</SectionTitle>
      <LeadNotePanel leadId={lead.id} onSaved={addNote} />

      <div id="lead-timeline" className="scroll-mt-4">
        <LeadTimeline leadId={lead.id} history={history} attachments={attachments} />
      </div>

      <DataHealthPanel issues={healthIssues} onFix={fixHealthIssue} />

      <IntegrityPanel
        evidence={{
          address: lead.address,
          phoneSource: lead.contactPhone === undefined ? null : (contactSourceOf(lead) ?? null),
          hasEmail: false,
          callConsentAt: lead.consent?.call?.at ?? null,
          smsConsentAt: lead.consent?.sms?.at ?? null,
          callWindowRuleIds: window.ruleIds,
          optedOut: lead.optedOutAt !== undefined,
          stormSource: null,
          stormEventAt: null,
          imageryCapturedAt: null,
          // 'probable' is not counted. It means a fix existed and did not place
          // the rep at the door, and a line that says "GPS verified" has to mean
          // the stronger thing or it means nothing.
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

      <div id="lead-roofr" className="scroll-mt-4">
        <RoofrPanel leadId={lead.id} />
      </div>

      <SectionTitle>WHY IT WAS ON THE LIST</SectionTitle>
      <Card>
        <ul className="space-y-1">
          {lead.reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-white/70">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
              {reason}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] leading-relaxed text-white/25">
          Priority {lead.score} as it stood when you knocked. It is kept as it was, not recomputed,
          so this still says what you were looking at that day.
        </p>
      </Card>

      <Button variant="ghost" full className="mt-6" onClick={() => navigate('/leads')}>
        Back to the list
      </Button>
    </div>
  )
}
