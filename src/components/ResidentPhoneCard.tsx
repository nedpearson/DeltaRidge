import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import {
  buildFreeSearchUrl,
  buildTruePeopleSearchUrl,
  lookupResidentContact,
} from '@/features/leads/contact-enrichment'

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
  onPhoneSaved?: ((phone?: string | null, email?: string | null, name?: string | undefined) => void) | undefined
}) {
  const [phone, setPhone] = useState<string | null | undefined>(initialPhone)
  const [email, setEmail] = useState<string | null | undefined>(initialEmail)
  const [resident, setResident] = useState<string | null | undefined>(ownerName)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [inputPhone, setInputPhone] = useState('')

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
          onPhoneSaved?.(result.phone, result.email, result.residentName || ownerName || undefined)
        }
      }).catch(() => {
        if (active) setLoading(false)
      })
    }
    return () => {
      active = false
    }
  }, [address, autoEnrich, city, ownerName, phone, email, state, zip])

  const freeSearchUrl = buildFreeSearchUrl(address, city, state, zip)
  const tpsUrl = buildTruePeopleSearchUrl(address, city, state, zip)

  const handleSave = () => {
    if (!inputPhone.trim()) return
    const num = inputPhone.trim()
    setPhone(num)
    onPhoneSaved?.(num, email, resident || ownerName || undefined)
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
          <div className="flex shrink-0 items-center gap-1.5">
            {phone && (
              <>
                <a href={`tel:${phone.replace(/\D/g, '')}`} className="contents">
                  <Button variant="gold" className="!px-3 !py-1 text-[12px]">
                    Call
                  </Button>
                </a>
                <a href={`sms:${phone.replace(/\D/g, '')}`} className="contents">
                  <Button variant="secondary" className="!px-3 !py-1 text-[12px]">
                    Text
                  </Button>
                </a>
              </>
            )}
            {email && (
              <a href={`mailto:${email}`} className="contents">
                <Button variant="secondary" className="!px-3 !py-1 text-[12px]">
                  Email
                </Button>
              </a>
            )}
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
