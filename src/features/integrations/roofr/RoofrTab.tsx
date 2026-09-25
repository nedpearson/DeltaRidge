import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Field, SectionTitle, Select } from '@/components/ui'
import { Nothing, ago } from '@/features/manager/tabs/shared'
import {
  generateWebhookToken,
  readSettings,
  readSyncLog,
  saveSettings,
  type PushThreshold,
  type RoofrSettings,
  type SyncRow,
} from './store'

/**
 * Connecting Roofr, and being able to see whether it is working.
 *
 * The screen is mostly a sync log, which is the part that earns its place: an
 * integration that breaks silently is worse than one that was never built,
 * because the office spends a month believing the leads are flowing. Every
 * event Roofr sent is listed here with what happened to it, including the ones
 * that arrived malformed or matched no lead.
 */

const THRESHOLDS: { id: PushThreshold; label: string; detail: string }[] = [
  {
    id: 'manual_only',
    label: 'Only when somebody presses the button',
    detail: 'Nothing goes to Roofr on its own. The safest place to start.',
  },
  {
    id: 'interested',
    label: 'Once the homeowner is interested',
    detail: 'Earlier, more records in Roofr, more of them going nowhere.',
  },
  {
    id: 'inspection_scheduled',
    label: 'Once an inspection is booked (recommended)',
    detail:
      'The point where somebody has agreed to something. Keeps thousands of canvassed doors in Delta Ridge and gives Roofr the ones the office will actually work.',
  },
  {
    id: 'manager_approved',
    label: 'Only when a manager approves it',
    detail: 'A rep can ask; the server refuses unless a manager or admin is the one asking.',
  },
]

function StatusPill({ status }: { status: string }) {
  // Green for what landed, amber for what was recorded but not linked, red for
  // what broke. A person should be able to read this column at a glance.
  const tone =
    status === 'processed' || status === 'acknowledged'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'failed' || status === 'given_up'
        ? 'bg-red-500/15 text-red-300'
        : 'bg-amber-500/15 text-amber-300'
  return <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>{status}</span>
}

export default function RoofrTab({
  organizationId,
  canManage,
}: {
  organizationId: string | null
  canManage: boolean
}) {
  const [settings, setSettings] = useState<RoofrSettings | null>(null)
  const [log, setLog] = useState<SyncRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Held in memory only, shown once, never stored anywhere. */
  const [freshToken, setFreshToken] = useState<string | null>(null)

  const load = useCallback(
    async (keepError = false) => {
      if (organizationId === null) return
      setLoading(true)
      if (!keepError) setError(null)
      const [next, rows] = await Promise.all([
        readSettings(organizationId),
        readSyncLog(organizationId),
      ])
      setSettings(next)
      setLog(rows)
      setLoading(false)
    },
    [organizationId],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (organizationId === null) {
    return <Nothing title="No organisation" body="Sign in before connecting Roofr." />
  }

  const patch = async (change: Parameters<typeof saveSettings>[1]) => {
    const result = await saveSettings(organizationId, change)
    if (!result.ok) {
      setError(result.error)
      // keepError, or the reload immediately replaces the reason with nothing
      // and the button looks like it did nothing at all.
      await load(true)
      return
    }
    await load()
  }

  const rotate = async () => {
    const { token, hash, hint } = await generateWebhookToken()
    const result = await saveSettings(organizationId, { secretHash: hash, secretHint: hint })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setFreshToken(token)
    await load(true)
  }

  const endpoint = `${import.meta.env['VITE_SUPABASE_URL'] ?? ''}/functions/v1/roofr-events`

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint="Roofr sends events here through a Zap. This endpoint only accepts them with the token below.">
          Inbound webhook
        </SectionTitle>

        <p className="mt-3 break-all rounded bg-black/30 px-3 py-2 font-mono text-xs text-slate-600">
          {endpoint}
        </p>

        <div className="mt-3 text-sm text-slate-600">
          {settings?.secretHint === null || settings?.secretHint === undefined ? (
            <p>No token yet. Roofr events will be rejected until one is created.</p>
          ) : (
            <p>
              Token ending <span className="font-mono text-slate-600">{settings.secretHint}</span>,
              created {ago(settings.secretRotatedAt)}.
            </p>
          )}
        </div>

        {canManage && (
          <Button className="mt-3" onClick={() => void rotate()}>
            {settings?.secretHint ? 'Replace token' : 'Create token'}
          </Button>
        )}

        {freshToken !== null && (
          <div className="mt-3 rounded border border-gold-400/40 bg-gold-400/10 px-3 py-3">
            <p className="text-sm text-gold-700">
              Copy this now. It is not stored and cannot be shown again.
            </p>
            <p className="mt-2 break-all font-mono text-xs text-[var(--color-ink)]">{freshToken}</p>
            <p className="mt-2 text-xs text-slate-600">
              In the Zap’s webhook step, send it as the header{' '}
              <span className="font-mono">x-delta-ridge-token</span>.
            </p>
            <Button className="mt-3" onClick={() => setFreshToken(null)}>
              I have copied it
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle hint="Creating jobs in Roofr from Delta Ridge. Off until a real Zap has been seen to work.">
          Sending leads to Roofr
        </SectionTitle>

        <label className="mt-3 flex items-center gap-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={settings?.pushEnabled === true}
            disabled={!canManage}
            onChange={(e) => void patch({ pushEnabled: e.target.checked })}
          />
          Allow Delta Ridge to create jobs in Roofr
        </label>
        <p className="mt-1 text-xs text-slate-600">
          Roofr’s own documentation still describes the Zapier integration as one-way. Leave this off
          until a test Zap has actually created a job on your account.
        </p>

        <div className="mt-4" />
        <Field
          label="When a lead goes to Roofr"
          hint={THRESHOLDS.find((t) => t.id === settings?.pushThreshold)?.detail ?? ''}
        >
          <Select
            value={settings?.pushThreshold ?? 'inspection_scheduled'}
            disabled={!canManage}
            onChange={(e) => void patch({ pushThreshold: e.target.value as PushThreshold })}
          >
            {THRESHOLDS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card>
        <SectionTitle hint="Both directions. This is where a quietly broken Zap becomes visible.">
          Sync log
        </SectionTitle>

        {error !== null && (
          <p className="mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        {loading ? (
          <p className="mt-3 text-sm text-slate-600">Loading…</p>
        ) : log.length === 0 ? (
          <Nothing
            title="Nothing has come through yet"
            body="Once the Zaps are switched on, every event Roofr sends appears here — including the ones that could not be matched to a lead."
          />
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs text-slate-600">
                  {r.direction === 'inbound' ? 'from' : 'to'} Roofr
                </span>
                <span className="flex-1 text-slate-600">{r.what.replace(/_/g, ' ')}</span>
                <StatusPill status={r.status} />
                <span className="w-20 shrink-0 text-right text-xs text-slate-600">{ago(r.at)}</span>
                {r.error !== null && (
                  <span className="w-full text-xs text-amber-300/70">{r.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
