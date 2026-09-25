import { useCallback, useEffect, useState } from 'react'
import { Card, SectionTitle, TextInput } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'
import { isTraceId } from './trace'

/**
 * "What happened to this lead?"
 *
 * The question a manager asks on the phone while a rep stands in a driveway
 * insisting they recorded something. Before this it took an afternoon and a
 * database client.
 *
 * The column worth looking at is `carried` — how long the phone held the work
 * before the server heard about it. A four-hour carry is the ordinary
 * explanation for "it never synced", and it is invisible unless both clocks are
 * kept, which is why the table stores the device's time separately from its own.
 */

interface Row {
  readonly traceId: string
  readonly layer: string
  readonly step: string
  readonly outcome: string
  readonly detail: string | null
  readonly deviceAt: string | null
  readonly at: string
  readonly carriedSeconds: number | null
}

const TONE: Record<string, string> = {
  ok: 'text-emerald-300',
  started: 'text-slate-600',
  refused: 'text-amber-300',
  failed: 'text-red-300',
  unknown: 'text-amber-300',
}

function carriedLabel(seconds: number | null): string | null {
  if (seconds === null || seconds < 60) return null
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `carried ${minutes} min`
  return `carried ${Math.round(minutes / 60)} hr`
}

export default function TracePanel({ leadId }: { leadId?: string }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(
    async (trace: string | null) => {
      const supabase = getSupabase()
      if (!supabase) {
        setNote('No connection to the server.')
        return
      }
      if (trace === null && leadId === undefined) return

      setLoading(true)
      setNote(null)
      let request = supabase
        .from('lead_trace')
        .select('trace_id, layer, step, outcome, detail, device_at, at, carried_seconds')
        .order('at', { ascending: true })
        .limit(200)

      request = trace !== null ? request.eq('trace_id', trace) : request.eq('lead_id', leadId ?? '')

      const { data, error } = await request
      setLoading(false)
      if (error !== null) {
        setNote(error.message)
        return
      }
      const mapped = ((data ?? []) as unknown[]).map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          traceId: r['trace_id'] as string,
          layer: r['layer'] as string,
          step: r['step'] as string,
          outcome: r['outcome'] as string,
          detail: (r['detail'] as string | null) ?? null,
          deviceAt: (r['device_at'] as string | null) ?? null,
          at: r['at'] as string,
          carriedSeconds: (r['carried_seconds'] as number | null) ?? null,
        }
      })
      setRows(mapped)
      if (mapped.length === 0) setNote('Nothing recorded against that.')
    },
    [leadId],
  )

  useEffect(() => {
    if (leadId !== undefined) void load(null)
  }, [leadId, load])

  const search = () => {
    const trimmed = query.trim()
    if (trimmed === '') return
    if (!isTraceId(trimmed)) {
      // Said rather than silently returning nothing, because the ids get read
      // aloud over the phone and a mistyped one is the common case.
      setNote('That is not a trace id. They look like tr_ followed by 16 characters.')
      setRows([])
      return
    }
    void load(trimmed)
  }

  return (
    <Card>
      <SectionTitle hint="Every step a piece of field work passed through, on the device and on the server.">
        WHAT HAPPENED
      </SectionTitle>

      <div className="mt-3 flex gap-2">
        <TextInput
          value={query}
          placeholder="tr_…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search()
          }}
        />
      </div>

      {note !== null && <p className="mt-2 text-[12px] text-slate-600">{note}</p>}
      {loading && <p className="mt-2 text-[12px] text-slate-600">Loading…</p>}

      {rows.length > 0 && (
        <ol className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li key={`${row.traceId}-${row.step}-${index}`} className="text-[12px] leading-relaxed">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={`min-w-0 break-words ${TONE[row.outcome] ?? 'text-slate-600'}`}>
                  {row.step.replace(/[._]/g, ' ')}
                </span>
                <span className="shrink-0 text-[11px] text-slate-600">
                  {new Date(row.at).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                {row.layer}
                {carriedLabel(row.carriedSeconds) !== null && ` · ${carriedLabel(row.carriedSeconds)}`}
              </p>
              {row.detail !== null && (
                <p className="mt-0.5 break-words text-[11.5px] text-amber-700/70">{row.detail}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
