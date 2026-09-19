import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import CapturePanel from '@/features/inspections/CapturePanel'
import NotesPanel from '@/features/inspections/NotesPanel'
import ReviewPanel from '@/features/inspections/ReviewPanel'
import { requiredCategoriesFor, type PhotoCategory } from '@/features/inspections/photo-categories'
import {
  getInspection, listObservations, listPhotos, queueHandoff, saveInspection,
  type LocalInspection, type LocalObservation, type LocalPhoto,
} from '@/lib/db'

type Tab = 'capture' | 'notes' | 'review'

const TABS: Array<[Tab, string]> = [
  ['capture', 'Photos'],
  ['notes', 'Notes'],
  ['review', 'Review'],
]

export default function InspectionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('capture')
  const [inspection, setInspection] = useState<LocalInspection | null>(null)
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [observations, setObservations] = useState<LocalObservation[]>([])
  const [focusCategory, setFocusCategory] = useState<PhotoCategory | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!id) return
    const [i, p, o] = await Promise.all([getInspection(id), listPhotos(id), listObservations(id)])
    setInspection(i ?? null)
    setPhotos(p)
    setObservations(o)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patch = useCallback(
    (p: Partial<LocalInspection>) => {
      setInspection((current) => {
        if (!current) return current
        const next = { ...current, ...p }
        void saveInspection(next)
        return next
      })
    },
    [],
  )

  if (loading) {
    return <p className="pt-10 text-center text-[13px] text-white/40">Loading inspection…</p>
  }

  if (!inspection) {
    return (
      <div className="pt-10 text-center">
        <p className="text-[14px] text-white/60">That inspection is not on this device.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate('/')}>
          Back to home
        </Button>
      </div>
    )
  }

  const required = requiredCategoriesFor(inspection.propertyType, inspection.stories)

  function fixNow(category: PhotoCategory) {
    setFocusCategory(category)
    setTab('capture')
    // Let the tab render before scrolling to the card the rep needs.
    window.setTimeout(() => {
      document.getElementById(`cat-${category}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 60)
  }

  /**
   * Completing and sending are one action for the rep, but two writes that must
   * happen in order: the inspection is saved and awaited BEFORE the handoff is
   * queued, because the package is built by reading the inspection back out of
   * IndexedDB. Firing both through `patch` would race — the handoff could be
   * built from the pre-completion record and reach the office without the
   * completion time or the override note on it.
   */
  async function sendToOffice(current: LocalInspection, override?: { codes: string[]; note?: string }) {
    const next: LocalInspection = {
      ...current,
      status: 'complete',
      completedAt: current.completedAt ?? new Date().toISOString(),
      ...(override
        ? { overriddenIssueCodes: override.codes, ...(override.note ? { overrideNote: override.note } : {}) }
        : {}),
    }
    await saveInspection(next)
    await queueHandoff(next.id)
    navigate('/')
  }

  const usable = photos.filter((p) => !p.retakeRecommended).length

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => navigate(-1)} className="-ml-2 !min-h-0 px-2 py-1 text-[13px] text-white/45">
          ← Back
        </button>
        {inspection.status === 'complete' && (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/25">
            Completed
          </span>
        )}
      </div>

      <h1 className="mt-1 font-display text-lg leading-tight tracking-wide">{inspection.addressLine1}</h1>
      <p className="mt-0.5 text-[12px] text-white/40">
        {[inspection.city, inspection.parish && `${inspection.parish} Parish`].filter(Boolean).join(' · ')}
        {usable > 0 && ` · ${usable} photo${usable === 1 ? '' : 's'}`}
      </p>

      <div className="sticky top-[57px] z-10 -mx-4 mt-3 bg-[var(--color-surface)]/95 px-4 py-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--color-surface-2)] p-1">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-lg py-2 text-[13px] font-semibold transition-colors ${
                tab === value ? 'bg-brand-500 text-white' : 'text-white/45'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {tab === 'capture' && (
          <CapturePanel
            inspectionId={inspection.id}
            photos={photos}
            required={required}
            onChanged={() => void refresh()}
            focusCategory={focusCategory}
          />
        )}
        {tab === 'notes' && (
          <NotesPanel
            inspectionId={inspection.id}
            observations={observations}
            onChanged={() => void refresh()}
          />
        )}
        {tab === 'review' && (
          <ReviewPanel
            inspection={inspection}
            photos={photos}
            observations={observations}
            required={required}
            onFix={fixNow}
            onPatch={patch}
            onComplete={(override) => void sendToOffice(inspection, override)}
          />
        )}
      </div>
    </div>
  )
}
