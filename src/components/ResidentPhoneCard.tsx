import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import {
  buildFreeSearchUrl,
  buildTruePeopleSearchUrl,
  lookupResidentContact,
} from '@/features/leads/contact-enrichment'
import type { ContactSource } from '@/features/leads/pipeline'

export default function ResidentPhoneCard({
  address,
  city = 'Baton Rouge',
  state = 'LA',
  zip = '70810',
  ownerName,
  phone: initialPhone,
  email: initialEmail,
  autoEnrich = true,
  onPhoneSaved,
}: {
  address: string
  city?: string | undefined
  state?: string | undefined
  zip?: string | undefined
  ownerName?: string | null | undefined
  phone?: string | null | undefined
  email?: string | null | undefined
  autoEnrich?: boolean | undefined
  onPhoneSaved?: ((
    phone?: string | null,
    email?: string | null,
    name?: string | undefined,
    source?: ContactSource,
  ) => void) | undefined
}) {
  const [phone, setPhone] = useState<string | null | undefined>(initialPhone)
  const [email, setEmail] = useState<string | null | undefined>(initialEmail)
  const [resident, setResident] = useState<string | null | undefined>(ownerName)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputPhone, setInputPhone] = useState('')
  const [inputSource, setInputSource] = useState<ContactSource>('unknown')

  useEffect(() => {
    setPhone(initialPhone)
    setEmail(initialEmail)
  }, [initialPhone, initialEmail])

  useEffect(() => {
    let active = true
    if (!phone && !email && autoEnrich && address && !loading) {
      setLoading(true)
      void lookupResidentContact({
        street: address,
        city,
        state,
        zip,
        ownerName: ownerName || undefined,
      }).then((result) => {
        if (!active) return
        setLoading(false)
        if (result.success && (result.phone || result.email)) {
          if (result.phone) setPhone(result.phone)
          if (result.email) setEmail(result.email)
          if (result.residentName) setResident(result.residentName)
          onPhoneSaved?.(
            result.phone,
            result.email,
            result.residentName || ownerName || undefined,
            result.source ?? 'third_party_lookup',
          )
        }
      }).catch(() => {
        if (active) setLoading(false)
      })
    }
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, autoEnrich, city, ownerName, phone, email, state, zip])

  const freeSearchUrl = buildFreeSearchUrl(address, city, state, zip)
  const tpsUrl = buildTruePeopleSearchUrl(address, city, state, zip)

  const handleSave = () => {
    if (!inputPhone.trim()) return
    const num = inputPhone.trim()
    setPhone(num)
    onPhoneSaved?.(num, email, resident || ownerName || undefined, inputSource)
    setEditing(false)
  }

  if (phone || email) {
    return (
      <div className="mt-2.5 flex flex-col gap-2 rounded-xl bg-bg-page p-2.5 ring-1 ring-border-subtle">
        <div className="flex items-center justify-between min-w-0 pr-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                Resident Contact
              </span>
              {(resident || ownerName) && (
                <span className="truncate text-[11px] text-text-muted">· {resident || ownerName}</span>
              )}
            </div>
            {phone && (
              <p className="mt-0.5 font-mono text-[14px] font-semibold text-text-primary">
                {phone}
              </p>
            )}
            {email && (
              <p className="mt-0.5 text-[12px] text-text-secondary truncate max-w-[200px]">
                {email}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-route-live">
              Contact found
            </p>
            <p className="mt-0.5 max-w-28 text-[9.5px] leading-tight text-text-muted">
              Verify identity and permission in Lead 360 before contacting.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2.5 rounded-xl bg-bg-app p-2.5 ring-1 ring-border-subtle">
      {!editing ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-text-secondary">
              {loading
                ? '⚡ Auto-enriching phone number…'
                : (resident || ownerName)
                  ? `Phone for ${resident || ownerName}`
                  : 'Homeowner Phone Number'}
            </p>
            <p className="text-[10.5px] text-text-muted">
              {loading ? 'Querying skip-trace records…' : 'Automated skip-trace & reverse directory'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={freeSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="contents"
            >
              <Button variant="secondary" className="!px-2.5 !py-1 text-[11px]">
                🔍 Look Up
              </Button>
            </a>
            <Button
              variant="secondary"
              onClick={() => setEditing(true)}
              className="!px-2.5 !py-1 text-[11px]"
            >
              + Add
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
              Save Resident Phone
            </p>
            <a
              href={tpsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10.5px] text-status-warning hover:underline"
            >
              Search Records ↗
            </a>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-text-muted">Where did this number come from?</span>
            <select
              value={inputSource}
              onChange={(e) => setInputSource(e.target.value as ContactSource)}
              className="w-full rounded-lg border border-border-subtle bg-bg-card px-2.5 py-2 text-[12px] text-text-primary focus:border-brand-primary focus:outline-none"
            >
              <option value="unknown">Source not recorded</option>
              <option value="homeowner_at_door">Homeowner gave it at the door</option>
              <option value="homeowner_by_phone">Homeowner gave it on a call</option>
              <option value="homeowner_in_writing">Homeowner provided it in writing</option>
              <option value="public_record">Public record</option>
              <option value="third_party_lookup">Records / skip-trace lookup</option>
            </select>
          </label>
          <div className="flex gap-2">
            <input
              type="tel"
              placeholder="(225) 555-0199"
              value={inputPhone}
              onChange={(e) => setInputPhone(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-bg-card px-2.5 py-1 text-[13px] text-text-primary focus:border-amber-500 focus:outline-none"
              autoFocus
            />
            <Button variant="gold" onClick={handleSave} disabled={!inputPhone.trim()} className="!px-3 !py-1 text-[12px]">
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} className="!px-3 !py-1 text-[12px]">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
