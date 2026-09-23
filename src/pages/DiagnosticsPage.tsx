import { useCallback, useEffect, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import { useSync } from '@/features/auth/useSync'
import { deviceId } from '@/lib/device'
import { listOutbox, retryStalledOutbox } from '@/lib/sync-store'
import { readSyncMeta } from '@/lib/sync/meta'
import { serverSnapshot } from '@/lib/sync/pull'
import { outboxStatus, type OutboxItem, type OutboxStatus } from '@/lib/db'

/**
 * The screen that answers "is my work actually on the server?"
 *
 * It exists because the honest answer was previously unavailable to anybody —
 * rep, manager or developer. The app said "saved", the queue said nothing, and
 * the database was empty. Every number here is read from the real queue at the
 * moment it is shown, and the two timestamps are kept apart on purpose: a clean
 * drain of an empty queue is not evidence that anything has ever reached the
 * server.
 */

const STATUS_LABEL: Record<OutboxStatus, string> = {
  pending: 'Waiting to send',
  retry: 'Waiting out a retry',
  blocked_auth: 'Needs sign-in',
  not_yours: 'Another sign-in',
  failed: 'Gave up',
}

const ENTITY_LABEL: Record<OutboxItem['entity'], string> = {
  inspection: 'Inspection',
  photo: 'Photo',
  observation: 'Note',
  voiceNote: 'Voice note',
  handoff: 'Office package',
  lead: 'Lead',
  leadActivity: 'Lead contact',
  leadAttachment: 'Lead recording',
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'never'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.floor(hours / 24)} days ago`
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] text-white/40">{label}</span>
      <span className={`text-right text-[12.5px] ${muted ? 'text-white/40' : 'text-white/80'}`}>{value}</span>
    </div>
  )
}

export default function DiagnosticsPage() {
  const { session, membership } = useSession()
  const { running, syncNow, pullNow, lastPull } = useSync()
  const [items, setItems] = useState<OutboxItem[]>([])
  const [meta, setMeta] = useState(() => readSyncMeta())
  const [server, setServer] = useState<{ leads: number; activities: number } | null>(null)

  const userId = session?.user.id ?? null
  const orgId = membership?.organizationId ?? null

  const refresh = useCallback(() => {
    void listOutbox().then(setItems).catch(() => undefined)
    setMeta(readSyncMeta())
    void serverSnapshot(orgId).then(setServer).catch(() => undefined)
  }, [orgId])

  useEffect(() => {
    refresh()
    // Five seconds is fine for the local numbers; the two server counts ride
    // along because they are HEAD requests that return a count and no rows.
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const counts = items.reduce<Record<OutboxStatus, number>>(
    (acc, item) => {
      const status = outboxStatus(item, userId)
      acc[status] += 1
      return acc
    },
    { pending: 0, retry: 0, blocked_auth: 0, not_yours: 0, failed: 0 },
  )

  const authState = !session
    ? 'Signed out'
    : !membership
      ? 'Signed in, no organization'
      : `Signed in · ${membership.role}`

  return (
    <div className="space-y-4">
      <SectionTitle>SYNC DIAGNOSTICS</SectionTitle>

      <Card>
        <Row label="Account" value={authState} />
        <Row label="User id" value={userId ?? '—'} muted />
        <Row label="Organization" value={membership?.organizationId ?? '—'} muted />
        <Row label="Device id" value={deviceId()} muted />
        <Row label="Connection" value={navigator.onLine ? 'Online' : 'Offline'} />
      </Card>

      <Card>
        {/*
          The distinction the whole screen turns on. "Last accepted by server"
          is the only line that proves the round trip works; a drain that found
          nothing to send proves only that the app is running.
        */}
        <Row label="Last accepted by server" value={ago(meta.lastPushAt)} />
        <Row label="Last clean drain" value={ago(meta.lastDrainAt)} muted />
        <Row label="In the queue" value={String(items.length)} />
      </Card>

      <Card>
        {/*
          Counted by the server, not by this device. Every other number on this
          screen is the app's account of its own behaviour, and the app's
          account was confidently wrong for months.
        */}
        <Row label="Leads the server holds" value={server ? String(server.leads) : '—'} />
        <Row label="Knocks the server holds" value={server ? String(server.activities) : '—'} muted />
        {!server && (
          <p className="mt-1 text-[12px] leading-relaxed text-white/35">
            {orgId ? 'Could not reach the server just now.' : 'Sign in to see what the server holds.'}
          </p>
        )}
      </Card>

      <Card>
        <Row label="Waiting to send" value={String(counts.pending)} />
        <Row label="Waiting out a retry" value={String(counts.retry)} />
        <Row label="Needs sign-in" value={String(counts.blocked_auth)} />
        <Row label="Another sign-in" value={String(counts.not_yours)} />
        <Row label="Gave up" value={String(counts.failed)} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void syncNow().then(refresh)} disabled={running}>
            {running ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void retryStalledOutbox().then(() => syncNow()).then(refresh)}
            disabled={running || counts.failed === 0}
          >
            Retry all failed
          </Button>
        </div>
      </Card>

      <Card>
        {/*
          The half of sync that did not exist until now. A device that pushes
          perfectly and never reads is still a device where a second rep cannot
          see the street you walked this morning.
        */}
        <Row label="New leads from the server" value={lastPull ? String(lastPull.inserted) : '—'} />
        <Row label="Refreshed from the server" value={lastPull ? String(lastPull.updated) : '—'} muted />
        <Row
          label="Held back (unsent local work)"
          value={lastPull ? String(lastPull.heldBack) : '—'}
          muted
        />
        <Row label="Knocks read back" value={lastPull ? String(lastPull.activities) : '—'} muted />
        {lastPull?.skipped && <Row label="Last pull skipped" value={lastPull.skipped} muted />}
        {lastPull?.errors.map((e, i) => (
          <p key={i} className="mt-1 break-words text-[12px] text-amber-200/70">
            {e}
          </p>
        ))}
        <Button variant="secondary" full className="mt-3" onClick={() => void pullNow()} disabled={running}>
          Read the server now
        </Button>
      </Card>

      {items.length > 0 && (
        <Card>
          <ul className="divide-y divide-white/6">
            {items.map((item) => {
              const status = outboxStatus(item, userId)
              return (
                <li key={item.id} className="py-2 text-[12px] leading-relaxed">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-white/70">{ENTITY_LABEL[item.entity]}</span>
                    <span className="text-white/40">{STATUS_LABEL[status]}</span>
                  </div>
                  <p className="text-white/30">
                    queued {ago(item.queuedAt)} · {item.attempts} attempt{item.attempts === 1 ? '' : 's'}
                  </p>
                  {item.lastError && <p className="mt-0.5 break-words text-white/45">{item.lastError}</p>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {items.length === 0 && (
        <p className="px-1 text-[12px] leading-relaxed text-white/35">
          The queue is empty. That means everything captured on this device has been accepted by the server — not
          that nothing was captured. Check "last accepted by server" above.
        </p>
      )}
    </div>
  )
}
