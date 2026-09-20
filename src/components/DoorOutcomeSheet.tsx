import { useState } from 'react'
import { Button, Field, TextArea, TextInput } from '@/components/ui'
import { OUTCOME_LABEL, type ApplyOptions, type DoorOutcome } from '@/features/leads/pipeline'

/**
 * What the rep taps standing at the door.
 *
 * One tap has to be enough, because the alternative is a rep who stops
 * recording outcomes by the fourth house and a pipeline that is quietly wrong
 * by Thursday. Everything past the tap — the note, the time — is optional and
 * comes after, never before.
 *
 * There is no "called and spoke to them" here on purpose. The app cannot know
 * whether a call was answered, so it does not offer to record that it was.
 */

interface Choice {
  outcome: DoorOutcome
  hint: string
  tone: string
}

const CHOICES: Choice[] = [
  { outcome: 'no_answer', hint: 'Back in 2 days', tone: 'bg-white/8 ring-1 ring-white/10' },
  { outcome: 'come_back', hint: 'Back in 3 days', tone: 'bg-white/8 ring-1 ring-white/10' },
  { outcome: 'interested', hint: 'Needs a visit', tone: 'bg-brand-500/20 ring-1 ring-brand-400/30' },
  { outcome: 'appointment_set', hint: 'Pick a time', tone: 'bg-gold-500/20 ring-1 ring-gold-400/30' },
  { outcome: 'inspect_now', hint: 'Opens an inspection', tone: 'bg-emerald-500/15 ring-1 ring-emerald-400/25' },
  { outcome: 'not_interested', hint: 'Off the list', tone: 'bg-white/5 ring-1 ring-white/8' },
]

/** Local datetime-local value to ISO, or undefined if the field is empty. */
function toIso(local: string): string | undefined {
  if (local === '') return undefined
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export default function DoorOutcomeSheet({
  address,
  onCancel,
  onRecord,
}: {
  address: string
  onCancel: () => void
  onRecord: (outcome: DoorOutcome, options: ApplyOptions) => void
}) {
  const [picked, setPicked] = useState<DoorOutcome | null>(null)
  const [note, setNote] = useState('')
  const [when, setWhen] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const needsTime = picked === 'appointment_set'
  const canSubmit = picked !== null && (!needsTime || toIso(when) !== undefined)

  const submit = () => {
    if (picked === null) return
    const appointmentAt = toIso(when)
    onRecord(picked, {
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
      ...(appointmentAt !== undefined ? { appointmentAt } : {}),
      ...(name.trim() !== '' ? { contactName: name.trim() } : {}),
      ...(phone.trim() !== '' ? { contactPhone: phone.trim() } : {}),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-[var(--color-surface-2)] p-4 pb-8 ring-1 ring-white/10">
        <p className="text-[11px] uppercase tracking-wider text-white/35">What happened at</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold">{address}</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {CHOICES.map((c) => (
            <button
              key={c.outcome}
              onClick={() => setPicked(c.outcome)}
              className={`rounded-xl px-3 py-3 text-left transition-colors ${c.tone} ${
                picked === c.outcome ? 'outline outline-2 outline-gold-400' : ''
              }`}
            >
              <span className="block text-[13.5px] font-semibold">{OUTCOME_LABEL[c.outcome]}</span>
              <span className="mt-0.5 block text-[10.5px] text-white/40">{c.hint}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setPicked('do_not_knock')}
          className={`mt-2 w-full rounded-xl bg-red-500/12 px-3 py-2.5 text-[12.5px] font-semibold text-red-300 ring-1 ring-red-500/25 ${
            picked === 'do_not_knock' ? 'outline outline-2 outline-red-400' : ''
          }`}
        >
          Do not knock here again
        </button>

        {needsTime && (
          <div className="mt-3">
            <Field label="Appointment time" hint="Stored on the device and shown on the lead.">
              <TextInput
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
          </div>
        )}

        {picked !== null && picked !== 'no_answer' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Name (optional)">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Who you spoke to" />
            </Field>
            <Field label="Phone (optional)">
              <TextInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="225…"
              />
            </Field>
          </div>
        )}

        {picked !== null && (
          <div className="mt-3">
            <Field label="Note (optional)">
              <TextArea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was said, in your words."
              />
            </Field>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="gold" onClick={submit} disabled={!canSubmit}>
            {needsTime && toIso(when) === undefined ? 'Pick a time' : 'Record it'}
          </Button>
        </div>
        <p className="mt-2 text-center text-[10.5px] leading-relaxed text-white/25">
          Saved on this device straight away. Nothing here claims a call was answered or a text
          was delivered — only that it was placed.
        </p>
      </div>
    </div>
  )
}
