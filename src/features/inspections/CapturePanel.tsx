import { useRef, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import PhotoThumb from '@/components/PhotoThumb'
import { deletePhoto, newId, savePhoto, type LocalPhoto } from '@/lib/db'
import { currentPosition, processPhoto } from '@/lib/image'
import {
  CATEGORY_GROUP,
  CATEGORY_LABELS,
  SUGGESTED_RESIDENTIAL,
  type PhotoCategory,
  type PhotoGroup,
} from './photo-categories'

const GROUP_ORDER: PhotoGroup[] = ['property', 'roof', 'penetrations', 'damage', 'accessories', 'other']
const GROUP_LABELS: Record<PhotoGroup, string> = {
  property: 'PROPERTY',
  roof: 'ROOF',
  penetrations: 'PENETRATIONS',
  damage: 'DAMAGE',
  accessories: 'ACCESSORIES',
  other: 'OTHER',
}

export default function CapturePanel({
  inspectionId,
  photos,
  required,
  onChanged,
  focusCategory,
}: {
  inspectionId: string
  photos: LocalPhoto[]
  required: PhotoCategory[]
  onChanged: () => void
  focusCategory?: PhotoCategory | undefined
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pendingCategory = useRef<PhotoCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Required first, then the suggested set, then anything already photographed
  // outside both — so the list a rep scrolls is ordered by what matters.
  const extra = photos
    .map((p) => p.category)
    .filter((c): c is PhotoCategory => c !== null && !required.includes(c) && !SUGGESTED_RESIDENTIAL.includes(c))
  const categories = [...new Set([...required, ...SUGGESTED_RESIDENTIAL, ...extra])]

  function openCamera(category: PhotoCategory) {
    pendingCategory.current = category
    setError(null)
    fileRef.current?.click()
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0]
    const category = pendingCategory.current
    if (!file || !category) return
    setBusy(true)
    setError(null)
    try {
      const [processed, pos] = await Promise.all([processPhoto(file), currentPosition(4000)])
      await savePhoto({
        id: newId(),
        inspectionId,
        category,
        blob: processed.full,
        thumbnail: processed.thumbnail,
        width: processed.width,
        height: processed.height,
        byteSize: processed.byteSize,
        capturedAt: new Date().toISOString(),
        retakeRecommended: processed.quality.retakeRecommended,
        syncState: 'local',
        ...(processed.quality.flag ? { qualityFlag: processed.quality.flag } : {}),
        ...(pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : {}),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be processed. Try again.')
    } finally {
      setBusy(false)
      pendingCategory.current = null
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: string) {
    await deletePhoto(id)
    onChanged()
  }

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: categories.filter((c) => CATEGORY_GROUP[c] === group),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="pb-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files)}
      />

      {busy && (
        <Card className="mb-3 !bg-brand-500/10 ring-brand-500/20">
          <p className="text-[13px] text-brand-700">Processing photo and checking quality…</p>
        </Card>
      )}
      {error && (
        <Card className="mb-3 !bg-red-500/10 ring-red-500/20">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      {grouped.map(({ group, items }) => (
        <div key={group}>
          <SectionTitle>{GROUP_LABELS[group]}</SectionTitle>
          <div className="space-y-2">
            {items.map((category) => {
              const shots = photos.filter((p) => p.category === category)
              const usable = shots.filter((p) => !p.retakeRecommended)
              const isRequired = required.includes(category)
              const satisfied = usable.length > 0
              const focused = focusCategory === category

              return (
                <Card
                  key={category}
                  id={`cat-${category}`}
                  className={`${focused ? 'ring-2 ring-gold-400' : ''} ${satisfied ? '' : isRequired ? 'ring-brand-500/25' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[14px] font-semibold capitalize">
                        {CATEGORY_LABELS[category]}
                        {isRequired && !satisfied && (
                          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                            Required
                          </span>
                        )}
                        {satisfied && <span className="text-[13px] text-emerald-400">✓</span>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-ink)]/">
                        {shots.length === 0
                          ? 'No photo yet'
                          : `${usable.length} usable${shots.length > usable.length ? ` · ${shots.length - usable.length} flagged` : ''}`}
                      </p>
                    </div>
                    <Button
                      variant={satisfied ? 'secondary' : isRequired ? 'primary' : 'secondary'}
                      onClick={() => openCamera(category)}
                      disabled={busy}
                      className="!px-3.5 !py-2.5 text-[13px]"
                    >
                      {satisfied ? 'Add' : 'Capture'}
                    </Button>
                  </div>

                  {shots.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {shots.map((p) => (
                        <div key={p.id} className="relative shrink-0">
                          <PhotoThumb
                            blob={p.thumbnail}
                            alt={CATEGORY_LABELS[category]}
                            className={`size-20 rounded-lg object-cover ${p.retakeRecommended ? 'opacity-50 ring-2 ring-amber-500' : 'ring-1 ring-slate-200'}`}
                          />
                          <button
                            onClick={() => void remove(p.id)}
                            aria-label="Delete photo"
                            className="absolute -right-1 -top-1 grid size-6 !min-h-0 !min-w-0 place-items-center rounded-full bg-black/80 text-[13px] text-[var(--color-ink)]/ ring-1 ring-slate-200"
                          >
                            ×
                          </button>
                          {p.retakeRecommended && (
                            <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-amber-500/90 py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-black">
                              {p.qualityFlag}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {shots.some((p) => p.retakeRecommended) && (
                    <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                      A photo here was flagged automatically. Retake it or delete it — flagged photos do not count
                      toward completeness.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
