import { useEffect, useRef, useState } from 'react'
import { Button, Card, Empty, Field, SectionTitle, Select, TextArea } from '@/components/ui'
import {
  deleteObservation, listVoiceNotes, newId, saveObservation, saveVoiceNote,
  type LocalObservation, type LocalVoiceNote,
} from '@/lib/db'

const SEVERITIES: Array<[LocalObservation['severity'], string]> = [
  ['requires_verification', 'Needs verification'],
  ['none_noted', 'Nothing of concern'],
  ['minor', 'Minor'],
  ['moderate', 'Moderate'],
  ['significant', 'Significant'],
]

const SEVERITY_TONE: Record<LocalObservation['severity'], string> = {
  none_noted: 'bg-slate-100 hover:bg-slate-200 text-[var(--color-ink)]/ ring-slate-200',
  minor: 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
  moderate: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
  significant: 'bg-red-500/10 text-red-300 ring-red-500/25',
  requires_verification: 'bg-violet-500/10 text-violet-300 ring-violet-500/25',
}

function AudioNote({ note }: { note: LocalVoiceNote }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(note.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [note.blob])
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[var(--color-ink)]/">
          {new Date(note.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
          {note.durationSeconds}s
        </p>
      </div>
      {url && <audio controls src={url} className="mt-2 w-full" />}
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink)]/">
        Saved on this device. Automatic transcription turns on once an AI provider is connected — until then, type
        the important parts as observations so they reach the office.
      </p>
    </Card>
  )
}

export default function NotesPanel({
  inspectionId,
  observations,
  onChanged,
}: {
  inspectionId: string
  observations: LocalObservation[]
  onChanged: () => void
}) {
  const [finding, setFinding] = useState('')
  const [area, setArea] = useState('')
  const [severity, setSeverity] = useState<LocalObservation['severity']>('requires_verification')
  const [voiceNotes, setVoiceNotes] = useState<LocalVoiceNote[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recError, setRecError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef<number>(0)
  const timerRef = useRef<number | null>(null)

  const refreshVoice = () => void listVoiceNotes(inspectionId).then(setVoiceNotes)
  useEffect(refreshVoice, [inspectionId])

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function add() {
    if (!finding.trim()) return
    await saveObservation({
      id: newId(),
      inspectionId,
      finding: finding.trim(),
      severity,
      source: 'inspector',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      syncState: 'local',
      ...(area.trim() ? { area: area.trim() } : {}),
    })
    setFinding('')
    setArea('')
    onChanged()
  }

  async function startRecording() {
    setRecError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
        void saveVoiceNote({
          id: newId(),
          inspectionId,
          blob,
          durationSeconds: seconds,
          recordedAt: new Date(startedAt.current).toISOString(),
          syncState: 'local',
        }).then(refreshVoice)
        stream.getTracks().forEach((t) => t.stop())
      }
      recorder.start()
      recorderRef.current = recorder
      startedAt.current = Date.now()
      setElapsed(0)
      setRecording(true)
      timerRef.current = window.setInterval(
        () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
        500,
      )
    } catch {
      setRecError('Microphone access was blocked. Check the site permissions in your browser settings.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    setRecording(false)
  }

  return (
    <div className="pb-4">
      <SectionTitle>VOICE NOTE</SectionTitle>
      <Card>
        {recError ? (
          <p className="text-[13px] text-red-300">{recError}</p>
        ) : (
          <>
            <Button
              full
              variant={recording ? 'danger' : 'secondary'}
              onClick={() => (recording ? stopRecording() : void startRecording())}
            >
              {recording ? `Stop recording · ${elapsed}s` : 'Record a voice note'}
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink)]/">
              Talk through the roof as you walk it. Audio is stored on the device with the inspection.
            </p>
          </>
        )}
      </Card>
      {voiceNotes.length > 0 && (
        <div className="mt-2 space-y-2">
          {voiceNotes.map((n) => (
            <AudioNote key={n.id} note={n} />
          ))}
        </div>
      )}

      <SectionTitle hint={`${observations.length} recorded`}>OBSERVATIONS</SectionTitle>
      <Card className="space-y-3">
        <Field label="What did you see?">
          <TextArea
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
            placeholder="Rear-right pipe boot is cracked all the way through"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Where" hint="optional">
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="rear slope"
              className="w-full rounded-xl bg-[var(--color-surface-3)] px-3.5 py-3 text-[15px] text-[var(--color-ink)] ring-1 ring-slate-200 outline-none placeholder:text-[var(--color-ink)]/ focus:ring-2 focus:ring-brand-400"
            />
          </Field>
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as LocalObservation['severity'])}>
              {SEVERITIES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Button full variant="secondary" onClick={() => void add()} disabled={!finding.trim()}>
          Add observation
        </Button>
      </Card>

      {observations.length === 0 ? (
        <div className="mt-3">
          <Empty
            title="No observations yet"
            body="Anything you note here is cross-checked against your photos before you finish, so a condition never reaches the office without a picture."
          />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {observations.map((o) => (
            <Card key={o.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] leading-snug">{o.finding}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${SEVERITY_TONE[o.severity]}`}>
                      {SEVERITIES.find(([v]) => v === o.severity)?.[1]}
                    </span>
                    {o.area && <span className="text-[11px] text-[var(--color-ink)]/">{o.area}</span>}
                    {o.source === 'ai' && !o.confirmedAt && (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">
                        AI suggestion — unconfirmed
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void deleteObservation(o.id).then(onChanged)}
                  aria-label="Delete observation"
                  className="shrink-0 text-[var(--color-ink)]/ hover:text-[var(--color-ink)]/"
                >
                  ×
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
