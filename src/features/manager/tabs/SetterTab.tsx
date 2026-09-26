import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import {
  readSetterTasks,
  readSourceOutcomes,
  setSetterTaskStatus,
  type SetterTask,
  type SourceOutcome,
} from '@/features/leads/acquisition'

const SOURCE_LABEL: Record<string, string> = {
  door: 'Door', referral: 'Referral', organic: 'Organic', google_ads: 'Google Ads',
  meta_ads: 'Meta', roofcare: 'RoofCare', partner: 'Partner', manual: 'Manual',
  import: 'Import', other: 'Other',
}

function taskLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase())
}

function dueLabel(iso: string | null): string {
  if (!iso) return 'No due time'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'Due time unavailable'
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes < -60) return `${Math.abs(Math.round(minutes / 60))} hr overdue`
  if (minutes < 0) return `${Math.abs(minutes)} min overdue`
  if (minutes < 60) return `Due in ${minutes} min`
  if (minutes < 1440) return `Due in ${Math.round(minutes / 60)} hr`
  return new Date(iso).toLocaleString()
}

function SourceOutcomeCard({ row }: { row: SourceOutcome }) {
  const progressedRate = row.leads > 0 ? Math.round((row.progressed / row.leads) * 100) : null
  const soldRate = row.leads > 0 ? Math.round((row.sold / row.leads) * 100) : null
  return (
    <Card className="!py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-text-primary">{SOURCE_LABEL[row.source] ?? row.source}</p>
        <p className="font-display text-[18px] text-text-primary">{row.leads}</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div><p className="font-display text-[15px] text-text-primary">{row.progressed}</p><p className="text-[9.5px] uppercase tracking-wider text-text-secondary">Progressed</p></div>
        <div><p className="font-display text-[15px] text-text-primary">{row.sold}</p><p className="text-[9.5px] uppercase tracking-wider text-text-secondary">Sold</p></div>
        <div><p className="font-display text-[15px] text-text-primary">{progressedRate === null ? '—' : `${progressedRate}%`}</p><p className="text-[9.5px] uppercase tracking-wider text-text-secondary">Progress rate</p></div>
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
        Observed CRM history only{soldRate === null ? '' : ` · ${soldRate}% currently sold`}. This is not a predicted close rate.
      </p>
    </Card>
  )
}

export default function SetterTab({
  organizationId,
  onOpenLead,
}: {
  organizationId: string | null
  onOpenLead: (leadClientId: string) => void
}) {
  const [tasks, setTasks] = useState<SetterTask[]>([])
  const [sources, setSources] = useState<SourceOutcome[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [taskResult, sourceResult] = await Promise.all([
      readSetterTasks(organizationId),
      readSourceOutcomes(organizationId),
    ])
    setTasks(taskResult.rows)
    setSources(sourceResult.rows)
    setError(taskResult.error ?? sourceResult.error)
    setLoading(false)
  }, [organizationId])

  useEffect(() => { void load() }, [load])

  const change = async (
    task: SetterTask,
    status: 'in_progress' | 'done' | 'blocked' | 'cancelled',
  ) => {
    if (!organizationId) return
    setBusy(task.id)
    const result = await setSetterTaskStatus(
      organizationId,
      task.id,
      status,
      status === 'blocked' ? 'Requires manager or compliance review before action.' : undefined,
    )
    setBusy(null)
    if (result.error) { setError(result.error); return }
    await load()
  }

  return (
    <div className="space-y-4">
      <Card className="!py-3">
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Human qualification and appointment queue. A task never grants permission to call, text,
          or email. Open Lead 360 first and use its consent, opt-out, DNC, source and calling-window
          gates before any communication.
        </p>
      </Card>

      <SectionTitle hint={`${tasks.length} open/review tasks`}>APPOINTMENT SETTER</SectionTitle>

      {error && <Card className="border-l-4 border-l-status-critical !py-3"><p className="text-[12px] text-status-critical">{error}</p></Card>}

      {loading ? (
        <Card className="!py-3"><p className="text-[12px] text-text-secondary">Reading the server…</p></Card>
      ) : tasks.length === 0 ? (
        <Empty title="Setter queue is clear" body="Inbound inspection requests, appointment requests, callback requests and campaign responses will create human review tasks here." />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const overdue = task.dueAt !== null && Date.parse(task.dueAt) < Date.now()
            return (
              <Card key={task.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[13.5px] font-semibold text-text-primary">{task.address}</p>
                    <p className="mt-0.5 text-[11px] text-text-secondary">
                      {taskLabel(task.taskKind)}{task.source ? ` · ${SOURCE_LABEL[task.source] ?? task.source}` : ''}
                    </p>
                  </div>
                  <span className={
                    task.status === 'blocked'
                      ? 'shrink-0 rounded-full bg-status-critical/10 px-2 py-1 text-[9.5px] text-status-critical ring-1 ring-status-critical/20'
                      : overdue
                        ? 'shrink-0 rounded-full bg-warning-surface px-2 py-1 text-[9.5px] text-warning-highlight ring-1 ring-warning-border'
                        : 'shrink-0 rounded-full bg-bg-elevated px-2 py-1 text-[9.5px] text-text-secondary ring-1 ring-border-subtle'
                  }>
                    {task.status === 'blocked' ? 'BLOCKED' : dueLabel(task.dueAt)}
                  </span>
                </div>

                <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">{task.reason}</p>
                {task.blockedReason && <p className="mt-1 text-[11px] leading-relaxed text-status-critical">{task.blockedReason}</p>}

                <Button variant="secondary" full className="mt-3" disabled={!task.leadClientId} onClick={() => onOpenLead(task.leadClientId)}>
                  Open Lead 360 before action
                </Button>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button variant="ghost" disabled={busy === task.id} onClick={() => void change(task, 'in_progress')}>Working</Button>
                  <Button variant="ghost" disabled={busy === task.id} onClick={() => void change(task, 'blocked')}>Block</Button>
                  <Button variant="secondary" disabled={busy === task.id} onClick={() => void change(task, 'done')}>Done</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <SectionTitle hint="Descriptive source history">ACQUISITION SOURCES</SectionTitle>
      {sources.length === 0 ? (
        <Card className="!py-3"><p className="text-[11.5px] leading-relaxed text-text-secondary">No attributed inbound lead events have reached the server yet.</p></Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {sources.map((row) => <SourceOutcomeCard key={row.source} row={row} />)}
        </div>
      )}
    </div>
  )
}
