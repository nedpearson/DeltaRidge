import { useState } from 'react'
import { Button } from '@/components/ui'
import { buildFreeSearchUrl, buildTruePeopleSearchUrl } from '@/features/leads/contact-enrichment'

export default function ResidentPhoneCard({
  address,
  city = 'Baton Rouge',
  state = 'LA',
  zip = '70810',
  ownerName,
  phone,
  onPhoneSaved,
}: {
  address: string
  city?: string | undefined
  state?: string | undefined
  zip?: string | undefined
  ownerName?: string | null | undefined
  phone?: string | null | undefined
  onPhoneSaved?: ((phone: string, name?: string | undefined) => void) | undefined
}) {
  const [editing, setEditing] = useState(false)
  const [inputPhone, setInputPhone] = useState('')

  const freeSearchUrl = buildFreeSearchUrl(address, city, state, zip)
  const tpsUrl = buildTruePeopleSearchUrl(address, city, state, zip)

  const handleSave = () => {
    if (!inputPhone.trim()) return
    onPhoneSaved?.(inputPhone.trim(), ownerName || undefined)
    setEditing(false)
  }

  if (phone) {
    return (
      <div className="mt-2.5 flex items-center justify-between rounded-xl bg-slate-100 p-2.5 ring-1 ring-slate-200">
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Resident Phone
            </span>
            {ownerName && (
              <span className="truncate text-[11px] text-slate-400">· {ownerName}</span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[14px] font-semibold text-slate-800">
            {phone}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2.5 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      {!editing ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-slate-600">
              {ownerName ? `Find Phone for ${ownerName}` : 'Homeowner Phone Number'}
            </p>
            <p className="text-[10.5px] text-slate-400">Free instant reverse address lookup</p>
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
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Save Resident Phone
            </p>
            <a
              href={tpsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[10.5px] text-amber-700 hover:underline"
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
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[13px] text-slate-900 focus:border-amber-500 focus:outline-none"
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
