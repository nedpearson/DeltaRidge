import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Empty, Field, SectionTitle, TextArea, TextInput } from '@/components/ui'
import {
  addEvent,
  readHistory,
  readLead,
  saveLead,
  saveOutcome,
} from '@/features/leads/lead-store'
import {
  applyOutcome,
  CONTACT_KIND_LABEL,
  dueLabel,
  OUTCOME_LABEL,
  STATUS_LABEL,
  type ContactEvent,
  type ContactKind,
  type DoorOutcome,
  type ManagedLead,
} from '@/features/leads/pipeline'
import { newId, saveInspection, type LocalInspection } from '@/lib/db'

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
  const [lead, setLead] = useState<ManagedLead | null>(null)
  const [history, setHistory] = useState<ContactEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [reschedule, setReschedule] = useState('')

  const load = useCallback(async (leadId: string) => {
    const [found, events] = await Promise.all([readLead(leadId), readHistory(leadId)])
    setLead(found)
    setHistory(events)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (id) void load(id)
    else setLoading(false)
  }, [id, load])

  const record = useCallback(
    async (outcome: DoorOutcome) => {
      if (!lead) return
      const at = new Date().toISOString()
      const { lead: next, event } = applyOutcome(lead, outcome, at)
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
      await addEvent({ id: `${lead.id}:${at}:${kind}`, leadId: lead.id, at, kind })
      await load(lead.id)
    },
    [lead, load],
  )

  const addNote = useCallback(async () => {
    if (!lead || note.trim() === '') return
    const at = new Date().toISOString()
    await addEvent({
      id: `${lead.id}:${at}:note`,
      leadId: lead.id,
      at,
      kind: 'note',
      note: note.trim(),
    })
    setNote('')
    await load(lead.id)
  }, [lead, note, load])

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
        body="It may have been recorded on another device. Leads live on the device that captured them until sync is switched on."
      />
    )
  }

  const due = dueLabel(lead, new Date().toISOString())

  return (
    <div>
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

      {lead.contactPhone && (
        <>
          <SectionTitle>REACH THEM</SectionTitle>
          <Card>
            <p className="text-[15px] font-semibold">{lead.contactPhone}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`tel:${lead.contactPhone}`} className="contents">
                <Button variant="secondary" onClick={() => void logAttempt('call_placed')}>
                  Call
                </Button>
              </a>
              <a href={`sms:${lead.contactPhone}`} className="contents">
                <Button variant="secondary" onClick={() => void logAttempt('text_initiated')}>
                  Text
                </Button>
              </a>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-white/25">
              Recorded as placed and initiated. The app hands the number to your phone and cannot
              see whether it was answered or delivered, so it does not say that it was.
            </p>
          </Card>
        </>
      )}

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
      <Card>
        <TextArea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was said, in your words."
        />
        <Button
          variant="secondary"
          full
          className="mt-3"
          onClick={() => void addNote()}
          disabled={note.trim() === ''}
        >
          Add the note
        </Button>
      </Card>

      <SectionTitle hint={`${history.length} entries`}>HISTORY</SectionTitle>
      {history.length === 0 ? (
        <Empty
          title="Nothing recorded yet"
          body="Every knock, call, text and note lands here in order, so whoever picks this up next can see what was actually said."
        />
      ) : (
        <Card>
          <ol className="space-y-3">
            {history.map((event) => (
              <li key={event.id} className="border-l-2 border-white/10 pl-3">
                <p className="text-[12.5px] font-semibold text-white/80">
                  {event.outcome ? OUTCOME_LABEL[event.outcome] : CONTACT_KIND_LABEL[event.kind]}
                </p>
                <p className="text-[10.5px] text-white/30">
                  {when(event.at)} · {CONTACT_KIND_LABEL[event.kind]}
                </p>
                {event.note && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">{event.note}</p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

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
