import { useEffect, useRef, useState } from 'react'
import { Button, Card, TextArea } from '@/components/ui'
import { saveAttachment, type LeadAttachment } from '@/features/leads/lead-store'
import { newId } from '@/lib/db'
import { processPhoto } from '@/lib/image'

/**
 * Typing, talking or photographing — whichever the rep can manage right now.
 *
 * A rep walking back to the truck in the rain will not type three sentences,
 * and the note they do not write is the detail nobody has in two weeks. So the
 * same note can be spoken or photographed, and every form lands as one entry
 * in the same history rather than in three separate places.
 *
 * No transcription is claimed. The recording is stored and played back as a
 * recording; if a transcript ever appears it will be because something
 * actually transcribed it.
 */

function seconds(n: number): string {
  const m = Math.floor(n / 60)
  const s = n % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface PendingCapture {
  attachment: Omit<LeadAttachment, 'eventId'>
  label: string
}

export default function LeadNotePanel({
  leadId,
  onSaved,
}: {
  leadId: string
  /** Writes the note as a contact event and returns the event id. */
  onSaved: (note: string) => Promise<string>
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingCapture[]>([])
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timerRef = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const secs = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
        setPending((p) => [
          ...p,
          {
            label: `Voice · ${seconds(secs)}`,
            attachment: {
              id: newId(),
              leadId,
              kind: 'voice',
              blob,
              durationSeconds: secs,
              byteSize: blob.size,
              capturedAt: new Date(startedAt.current).toISOString(),
            },
          },
        ])
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
      setError('Microphone access was blocked. Check the site permissions in your browser settings.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    setRecording(false)
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const processed = await processPhoto(file)
      setPending((p) => [
        ...p,
        {
          label: 'Photo',
          attachment: {
            id: newId(),
            leadId,
            kind: 'photo',
            blob: processed.full,
            thumbnail: processed.thumbnail,
            width: processed.width,
            height: processed.height,
            byteSize: processed.byteSize,
            capturedAt: new Date().toISOString(),
          },
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be processed. Try again.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const canSave = !recording && !busy && (text.trim() !== '' || pending.length > 0)

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      // The event is written first so every attachment has a knock to hang
      // off. An attachment with no event is an orphan the history cannot show.
      const body =
        text.trim() !== ''
          ? text.trim()
          : pending.map((p) => p.label).join(', ')
      const eventId = await onSaved(body)
      for (const p of pending) {
        await saveAttachment({ ...p.attachment, eventId })
      }
      setText('')
      setPending([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That note could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files)}
      />

      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What was said, in your words."
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant={recording ? 'danger' : 'secondary'}
          onClick={() => (recording ? stopRecording() : void startRecording())}
        >
          {recording ? `Stop · ${seconds(elapsed)}` : 'Record a note'}
        </Button>
        <Button variant="secondary" disabled={busy || recording} onClick={() => fileRef.current?.click()}>
          Add a photo
        </Button>
      </div>

      {pending.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-300 pt-3">
          {pending.map((p, i) => (
            <li key={p.attachment.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-[12.5px] text-slate-600">{p.label}</span>
              <button
                onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                className="shrink-0 text-[11px] text-slate-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-[12.5px] leading-relaxed text-red-300">{error}</p>}

      <Button variant="secondary" full className="mt-3" onClick={() => void save()} disabled={!canSave}>
        {busy ? 'Saving…' : 'Add the note'}
      </Button>

      <p className="mt-2 text-[10.5px] leading-relaxed text-slate-600">
        Recordings and photos here are your own notes on this lead. They are kept apart from
        inspection photos on purpose — nothing captured here goes into the package the office sends
        an adjuster.
      </p>
    </Card>
  )
}
