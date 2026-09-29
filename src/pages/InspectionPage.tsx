import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, PageHeader, SegmentedTabs } from '@/components/ui'
import CapturePanel from '@/features/inspections/CapturePanel'
import NotesPanel from '@/features/inspections/NotesPanel'
import ReviewPanel from '@/features/inspections/ReviewPanel'
import { requiredCategoriesFor, type PhotoCategory } from '@/features/inspections/photo-categories'
import { holdUpdates } from '@/lib/sw-update'
import {
  getInspection, listObservations, listPhotos, queueHandoff, saveInspection,
  type LocalInspection, type LocalObservation, type LocalPhoto,
} from '@/lib/db'

type Tab = 'capture' | 'notes' | 'review'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'capture', label: 'Photos' },
  { id: 'notes', label: 'Notes' },
  { id: 'review', label: 'Review' },
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

  // Never reload under a rep mid-inspection. The hold is released on unmount,
  // so a waiting update applies by itself the moment they leave this screen.
  useEffect(() => holdUpdates('this inspection is open'), [])

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
    return <p className="pt-10 text-center text-[13px] text-text-secondary">Loading inspection…</p>
  }

  if (!inspection) {
    return (
      <div className="pt-10 text-center">
        <p className="text-[14px] text-text-secondary">That inspection is not on this device.</p>
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
    <div className="pb-24">
      <button onClick={() => navigate(-1)} className="-ml-2 mb-2 px-2 py-1 text-[13px] text-text-secondary">
        ← Back
      </button>

      <PageHeader
        eyebrow="Inspection"
        title={inspection.addressLine1}
        description={
          <>
            {[inspection.city, inspection.parish && `${inspection.parish} Parish`].filter(Boolean).join(' · ')}
            {usable > 0 && ` · ${usable} photo${usable === 1 ? '' : 's'}`}
          </>
        }
        action={
          inspection.status === 'complete' ? (
            <span className="rounded-full bg-status-success/10 px-2.5 py-1 text-[11px] font-medium text-status-success ring-1 ring-status-success/25">
              Complete
            </span>
          ) : undefined
        }
      />

      <div className="mt-3">
        <Link
          to={`/estimate/${inspection.id}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Price this roof
        </Link>
      </div>

      <div className="sticky top-[var(--app-header-height,0px)] z-10 -mx-3 mt-4 bg-bg-app/95 px-3 py-2 backdrop-blur-xl sm:-mx-4 sm:px-4">
        <SegmentedTabs items={TABS} value={tab} onChange={setTab} ariaLabel="Inspection sections" />
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

      {/* CONTEXTUAL ACTION BAR (Mobile Only) */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-border-subtle bg-bg-app/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:hidden">
        <Button variant="primary" className="flex-1 font-bold tracking-wide" onClick={() => setTab('capture')}>
          CAPTURE NEXT
        </Button>
      </div>
    </div>
  )
}
