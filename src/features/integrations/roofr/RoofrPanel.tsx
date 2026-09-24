import { useCallback, useEffect, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import { pushLeadToRoofr, readLink, readSettings, type RoofrLink, type RoofrSettings } from './store'

/**
 * Roofr, on the lead.
 *
 * The panel's job is to answer one question a rep standing on a driveway
 * actually has — "is this one already with the office, and where has it got
 * to?" — and to be honest when the answer is "we asked, nobody has confirmed".
 *
 * Every date shown here was sent by Roofr. Nothing on this panel is inferred
 * from Delta Ridge's own lead status, because the point of it is to show what
 * the other system thinks, and a panel that quietly falls back to our own data
 * when Roofr is silent would be worse than an empty one.
 */

function money(cents: number | null): string | null {
  if (cents === null) return null
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function day(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function RoofrPanel({ leadId }: { leadId: string }) {
  // Taken from the session rather than threaded down as a prop: the lead page is
  // offline-first and loads its lead from IndexedDB, where no organisation id is
  // stored. Asking the session is the one place that always knows.
  const { membership } = useSession()
  const organizationId = membership?.organizationId ?? null

  const [link, setLink] = useState<RoofrLink | null>(null)
  const [settings, setSettings] = useState<RoofrSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [nextLink, nextSettings] = await Promise.all([
      readLink(leadId),
      organizationId === null ? Promise.resolve(null) : readSettings(organizationId),
    ])
    setLink(nextLink)
    setSettings(nextSettings)
    setLoading(false)
  }, [leadId, organizationId])

  useEffect(() => {
    void load()
  }, [load])

  // Nothing to say, and no way to say it: don't put a dead card on every lead.
  if (loading) return null
  if (link === null && settings?.pushEnabled !== true) return null

  const send = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    const result = await pushLeadToRoofr(leadId)
    if (result.ok) {
      setMessage(result.state)
      await load()
    } else {
      setError(result.error)
    }
    setBusy(false)
  }

  const milestones: { label: string; at: string | null }[] = [
    { label: 'Report ordered', at: link?.reportOrderedAt ?? null },
    { label: 'Proposal sent', at: link?.proposalSentAt ?? null },
    { label: 'Opened by homeowner', at: link?.proposalViewedAt ?? null },
    { label: 'Signed', at: link?.proposalSignedAt ?? null },
    { label: 'Lost', at: link?.proposalLostAt ?? null },
  ].filter((m) => m.at !== null)

  const total = money(link?.proposalTotalCents ?? null)

  return (
    <Card>
      <SectionTitle hint="What Roofr has told us. Delta Ridge does not fill these in.">Roofr</SectionTitle>

      {link === null ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-white/60">This lead is not in Roofr yet.</p>
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? 'Sending…' : 'Create job in Roofr'}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {link.workflowStage !== null && (
              <span className="rounded bg-gold-400/15 px-2 py-0.5 text-sm text-gold-300">
                {link.workflowStage}
              </span>
            )}
            {link.roofrJobId !== null && (
              <span className="text-xs text-white/40">Roofr job {link.roofrJobId}</span>
            )}
          </div>

          {total !== null && (
            <p className="text-lg text-white">
              {total} <span className="text-xs text-white/40">proposal total, per Roofr</span>
            </p>
          )}

          {milestones.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {milestones.map((m) => (
                <li key={m.label} className="flex justify-between gap-4">
                  <span className="text-white/70">{m.label}</span>
                  <span className="text-white/40">{day(m.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/50">
              Linked to Roofr, but no proposal activity has come back yet.
            </p>
          )}
        </div>
      )}

      {message !== null && (
        <p className="mt-3 rounded bg-white/5 px-3 py-2 text-sm text-white/70">
          {/* Said this way on purpose: Zapier accepting a POST is not Roofr
              creating a job, and the panel will show the job the moment Roofr
              says so. */}
          {message}
        </p>
      )}
      {error !== null && (
        <p className="mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
    </Card>
  )
}
