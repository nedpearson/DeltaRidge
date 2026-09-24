import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import type { ManagedLead } from '@/features/leads/pipeline'
import {
  readLeadContactIdentity,
  setContactMethodStatus,
  type ContactMethodStatus,
  type LeadContactIdentity,
  type LeadContactMethod,
} from './identity-store'

const STATUS_LABEL: Record<ContactMethodStatus, string> = {
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed homeowner',
  wrong_number: 'Wrong number',
  disconnected: 'Disconnected',
  do_not_contact: 'Do not contact',
}

const STATUS_TONE: Record<ContactMethodStatus, string> = {
  unconfirmed: 'text-amber-200/80',
  confirmed: 'text-emerald-300',
  wrong_number: 'text-white/35',
  disconnected: 'text-white/35',
  do_not_contact: 'text-red-300',
}

function confidence(method: LeadContactMethod): string {
  if (method.providerConfidence === null) return 'confidence not supplied'
  return `${method.providerConfidence} provider confidence`
}

function sourceLine(method: LeadContactMethod): string {
  const retrieved = method.retrievedAt
    ? ` · retrieved ${new Date(method.retrievedAt).toLocaleDateString()}`
    : ''
  return `${method.source} · ${confidence(method)}${retrieved}`
}

export default function LeadContactIdentityPanel({ lead }: { lead: ManagedLead }) {
  const { session, membership } = useSession()
  const [identity, setIdentity] = useState<LeadContactIdentity | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIdentity(await readLeadContactIdentity(membership?.organizationId ?? null, lead.id))
  }, [lead.id, membership?.organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const phones = useMemo(
    () => identity?.methods.filter((method) => method.channel === 'phone') ?? [],
    [identity],
  )
  const emails = useMemo(
    () => identity?.methods.filter((method) => method.channel === 'email') ?? [],
    [identity],
  )

  const setStatus = useCallback(
    async (method: LeadContactMethod, status: ContactMethodStatus) => {
      const orgId = membership?.organizationId
      const userId = session?.user.id
      if (!orgId || !userId) return
      setBusy(method.id)
      try {
        const result = await setContactMethodStatus(orgId, method.id, status, userId)
        if (!result.error) await load()
      } finally {
        setBusy(null)
      }
    },
    [load, membership?.organizationId, session?.user.id],
  )

  return (
    <>
      <SectionTitle>CONTACT IDENTITY</SectionTitle>
      <Card>
        <div className="mb-3 border-b border-white/8 pb-3">
          <p className="text-[10.5px] uppercase tracking-wider text-white/30">Customer</p>
          <p className="mt-0.5 text-[14px] font-semibold text-white/90">
            {identity?.displayName ?? lead.contactName ?? 'Identity not confirmed'}
          </p>
          {identity?.error && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-200/75">
              Server contact list unavailable: {identity.error}
            </p>
          )}
        </div>

        <p className="text-[10.5px] uppercase tracking-wider text-white/30">Phone numbers</p>
        {phones.length === 0 ? (
          <p className="mt-1 text-[12px] text-white/40">
            No canonical phone records on the server yet.
            {lead.contactPhone ? ' The field lead still has a local primary number.' : ''}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {phones.map((method) => (
              <div key={method.id} className="rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[14px] font-semibold text-white/90">
                      {method.value}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${STATUS_TONE[method.status]}`}>
                      {STATUS_LABEL[method.status]} · {method.kind}
                    </p>
                    <p className="mt-1 break-words text-[10.5px] leading-relaxed text-white/30">
                      {sourceLine(method)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/6 px-2 py-1 text-[9.5px] uppercase tracking-wider text-white/35">
                    {method.label}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {method.status === 'confirmed' ? (
                    <a href={`tel:${method.value}`} className="contents">
                      <Button variant="secondary">Call</Button>
                    </a>
                  ) : (
                    <Button variant="secondary" disabled>
                      Call
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy === method.id || method.status === 'do_not_contact'}
                    onClick={() =>
                      void setStatus(
                        method,
                        method.status === 'confirmed' ? 'unconfirmed' : 'confirmed',
                      )
                    }
                  >
                    {method.status === 'confirmed' ? 'Mark unconfirmed' : 'Confirm owner'}
                  </Button>
                </div>

                {method.status !== 'do_not_contact' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="text-[10.5px] text-white/40 underline decoration-white/15 underline-offset-2"
                      onClick={() => void setStatus(method, 'wrong_number')}
                    >
                      Wrong number
                    </button>
                    <button
                      className="text-[10.5px] text-white/40 underline decoration-white/15 underline-offset-2"
                      onClick={() => void setStatus(method, 'disconnected')}
                    >
                      Disconnected
                    </button>
                    <button
                      className="text-[10.5px] text-red-300/80 underline decoration-red-300/20 underline-offset-2"
                      onClick={() => void setStatus(method, 'do_not_contact')}
                    >
                      Do not contact
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-white/8 pt-3">
          <p className="text-[10.5px] uppercase tracking-wider text-white/30">Email addresses</p>
          {emails.length === 0 ? (
            <p className="mt-1 text-[12px] text-white/40">No email addresses on the canonical record.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {emails.map((method) => (
                <div key={method.id} className="rounded-xl bg-white/4 p-3 ring-1 ring-white/8">
                  <p className="break-words text-[13px] font-medium text-white/85">{method.value}</p>
                  <p className={`mt-0.5 text-[11px] ${STATUS_TONE[method.status]}`}>
                    {STATUS_LABEL[method.status]}
                  </p>
                  <p className="mt-1 break-words text-[10.5px] text-white/30">{sourceLine(method)}</p>
                  {method.status === 'confirmed' ? (
                    <a
                      href={`mailto:${method.value}`}
                      className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-white/6 px-3 text-[12px] font-medium text-white/75 ring-1 ring-white/10"
                    >
                      Email
                    </a>
                  ) : (
                    <p className="mt-2 text-[10.5px] leading-relaxed text-white/30">
                      Email action stays off until a person confirms this belongs to the homeowner.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 border-t border-white/8 pt-3 text-[10.5px] leading-relaxed text-white/30">
          Provider confidence is evidence about a lookup result, not permission to contact. A
          confirmed identity still does not override consent, opt-out, do-not-call, or calling-hour
          rules elsewhere in Delta Ridge.
        </p>
      </Card>
    </>
  )
}
