import { useMemo, useState } from 'react'
import { Button, Card, Field, SectionTitle, TextArea, TextInput } from '@/components/ui'
import type { LocalInspection, LocalObservation, LocalPhoto } from '@/lib/db'
import { evaluateCompleteness, type CompletenessIssue } from './completeness'
import { CATEGORY_LABELS, type PhotoCategory } from './photo-categories'

const TONE: Record<CompletenessIssue['severity'], { ring: string; dot: string; label: string }> = {
  blocker: { ring: 'ring-red-500/30 bg-red-500/8', dot: 'bg-red-400', label: 'Office needs this' },
  warning: { ring: 'ring-amber-500/25 bg-amber-100', dot: 'bg-amber-400', label: 'Office will call' },
  advisory: { ring: 'ring-slate-200 bg-slate-200', dot: 'bg-slate-200', label: 'Worth adding' },
}

export default function ReviewPanel({
  inspection,
  photos,
  observations,
  required,
  onFix,
  onPatch,
  onComplete,
}: {
  inspection: LocalInspection
  photos: LocalPhoto[]
  observations: LocalObservation[]
  required: PhotoCategory[]
  onFix: (category: PhotoCategory) => void
  onPatch: (patch: Partial<LocalInspection>) => void
  onComplete: (override?: { codes: string[]; note?: string }) => void
}) {
  const [showPackage, setShowPackage] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')

  const report = useMemo(
    () =>
      evaluateCompleteness({
        roofMaterial: inspection.roofMaterial,
        requiredCategories: required,
        photos: photos.map((p) => ({
          id: p.id,
          category: p.category,
          area: p.area ?? null,
          retakeRecommended: p.retakeRecommended,
          qualityFlag: p.qualityFlag ?? null,
        })),
        observations: observations.map((o) => ({
          id: o.id,
          finding: o.finding,
          severity: o.severity,
          source: o.source,
          area: o.area ?? null,
          component: o.component ?? null,
          confirmedAt: o.confirmedAt ?? null,
        })),
        customerFirstName: inspection.customerFirstName ?? null,
        customerLastName: inspection.customerLastName ?? null,
        customerCompanyName: inspection.customerCompanyName ?? null,
        customerPhone: inspection.customerPhone ?? null,
        customerEmail: inspection.customerEmail ?? null,
        addressLine1: inspection.addressLine1 ?? null,
        stories: inspection.stories ?? null,
        inspectorRecommendation: inspection.inspectorRecommendation ?? null,
        ...(inspection.waivedCategories ? { waivedCategories: inspection.waivedCategories } : {}),
      }),
    [inspection, photos, observations, required],
  )

  const usablePhotos = photos.filter((p) => !p.retakeRecommended)
  const scoreTone =
    report.score >= 90 ? 'text-emerald-400' : report.score >= 70 ? 'text-gold-400' : 'text-amber-400'

  return (
    <div className="pb-4">
      <Card className="text-center">
        <p className="font-display text-[11px] tracking-[0.16em] text-[var(--color-ink)]/">DOCUMENTATION COMPLETENESS</p>
        <p className={`mt-1 font-display text-5xl ${scoreTone}`}>{report.score}</p>
        <p className="mt-1 text-[12px] text-[var(--color-ink)]/">
          {usablePhotos.length} usable photo{usablePhotos.length === 1 ? '' : 's'} · {observations.length} observation
          {observations.length === 1 ? '' : 's'}
        </p>
        <p className="mx-auto mt-3 max-w-xs text-[11px] leading-relaxed text-[var(--color-ink)]/">
          This scores how well the roof is documented — not its condition.
        </p>
      </Card>

      {report.issues.length === 0 ? (
        <Card className="mt-3 !bg-emerald-500/8 ring-emerald-500/20">
          <p className="text-[14px] font-semibold text-emerald-300">Nothing missing.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-emerald-700/70">
            Every required photo is captured, every observation has a supporting picture, and the office has what it
            needs to price this.
          </p>
        </Card>
      ) : (
        <>
          <SectionTitle hint={`${report.issues.length} to review`}>BEFORE YOU LEAVE</SectionTitle>
          <div className="space-y-2">
            {report.issues.map((issue) => {
              const tone = TONE[issue.severity]
              return (
                <div key={issue.code} className={`rounded-2xl p-3.5 ring-1 ${tone.ring}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink)]/">{tone.label}</p>
                      <p className="mt-0.5 text-[13.5px] leading-snug">{issue.message}</p>
                      {issue.fix?.kind === 'camera' && (
                        <Button
                          variant="secondary"
                          className="mt-2.5 !px-3 !py-2 text-[12px]"
                          onClick={() => issue.fix?.kind === 'camera' && onFix(issue.fix.category)}
                        >
                          Fix now — {CATEGORY_LABELS[issue.fix.category]}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionTitle>FILL THE GAPS</SectionTitle>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Homeowner phone">
            <TextInput
              value={inspection.customerPhone ?? ''}
              onChange={(e) => onPatch({ customerPhone: e.target.value })}
              placeholder="(225) 555-0142"
              inputMode="tel"
            />
          </Field>
          <Field label="Stories">
            <TextInput
              value={inspection.stories?.toString() ?? ''}
              onChange={(e) => onPatch({ stories: e.target.value ? Number(e.target.value) : undefined })}
              inputMode="numeric"
              placeholder="1"
            />
          </Field>
        </div>
        <Field label="Roof age the homeowner told you" hint="Recorded as their statement, not as verified fact">
          <TextInput
            value={inspection.homeownerStatedRoofAgeYears?.toString() ?? ''}
            onChange={(e) =>
              onPatch({ homeownerStatedRoofAgeYears: e.target.value ? Number(e.target.value) : undefined })
            }
            inputMode="numeric"
            placeholder="14"
          />
        </Field>
        <Field label="Insurer the homeowner named" hint="Their words. Nothing is verified here.">
          <TextInput
            value={inspection.homeownerStatedInsurer ?? ''}
            onChange={(e) => onPatch({ homeownerStatedInsurer: e.target.value })}
            placeholder="State Farm"
          />
        </Field>
        <Field label="Your recommendation to the office">
          <TextArea
            value={inspection.inspectorRecommendation ?? ''}
            onChange={(e) => onPatch({ inspectorRecommendation: e.target.value })}
            placeholder="Full replacement. Storm claim likely — hail bruising on three slopes."
          />
        </Field>
      </Card>

      <SectionTitle>OFFICE PACKAGE</SectionTitle>
      <Card>
        <Button variant="secondary" full onClick={() => setShowPackage((v) => !v)}>
          {showPackage ? 'Hide preview' : 'Preview what the office receives'}
        </Button>
        {showPackage && (
          <div className="mt-3 space-y-3 rounded-xl bg-black/25 p-3.5 text-[12.5px] leading-relaxed">
            <div>
              <p className="font-display text-[10px] tracking-widest text-[var(--color-ink)]/">CUSTOMER</p>
              <p className="mt-0.5">
                {[inspection.customerFirstName, inspection.customerLastName].filter(Boolean).join(' ') ||
                  inspection.customerCompanyName || <span className="text-red-400">— missing —</span>}
              </p>
              <p className="text-[var(--color-ink)]/">
                {inspection.customerPhone ?? inspection.customerEmail ?? (
                  <span className="text-red-400">no contact recorded</span>
                )}
              </p>
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[var(--color-ink)]/">PROPERTY</p>
              <p className="mt-0.5">{inspection.addressLine1}</p>
              <p className="text-[var(--color-ink)]/">
                {[inspection.city, inspection.parish && `${inspection.parish} Parish`, inspection.postalCode]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              <p className="mt-1 text-[var(--color-ink)]/">
                {inspection.roofMaterial.replace(/_/g, ' ')} · {inspection.stories ?? '?'} stor
                {inspection.stories === 1 ? 'y' : 'ies'}
                {inspection.homeownerStatedRoofAgeYears
                  ? ` · homeowner says ~${inspection.homeownerStatedRoofAgeYears} yrs old`
                  : ''}
              </p>
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[var(--color-ink)]/">OBSERVED CONDITIONS</p>
              {observations.length === 0 ? (
                <p className="mt-0.5 text-[var(--color-ink)]/">None recorded.</p>
              ) : (
                <ul className="mt-0.5 space-y-1">
                  {observations.map((o) => (
                    <li key={o.id} className="text-[var(--color-ink)]/">
                      • {o.finding}
                      {o.area ? ` (${o.area})` : ''} — {o.severity.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[var(--color-ink)]/">PHOTO REPORT</p>
              <p className="mt-0.5 text-[var(--color-ink)]/">
                {usablePhotos.length} photo{usablePhotos.length === 1 ? '' : 's'} across{' '}
                {new Set(usablePhotos.map((p) => p.category)).size} categories
              </p>
            </div>
            <div>
              <p className="font-display text-[10px] tracking-widest text-[var(--color-ink)]/">RECOMMENDED ACTION</p>
              <p className="mt-0.5 text-[var(--color-ink)]/">
                {inspection.inspectorRecommendation || <span className="text-[var(--color-ink)]/">Not yet written.</span>}
              </p>
            </div>
            {inspection.overriddenIssueCodes && inspection.overriddenIssueCodes.length > 0 && (
              <div className="rounded-lg bg-amber-100 px-3 py-2 ring-1 ring-amber-300">
                <p className="font-display text-[10px] tracking-widest text-amber-300/70">FINISHED WITH GAPS</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink)]/">
                  The rep closed this out with {inspection.overriddenIssueCodes.length} item
                  {inspection.overriddenIssueCodes.length === 1 ? '' : 's'} outstanding.
                  {inspection.overrideNote ? ` "${inspection.overrideNote}"` : ''}
                </p>
              </div>
            )}
            <p className="border-t border-slate-300 pt-2.5 text-[11px] text-[var(--color-ink)]/">
              Sending puts this package in the office queue on the Delta Ridge server, where the office can open it.
              Automatic delivery into CompanyCam — which syncs onward into Roofr — turns on once an API token is
              configured.
            </p>
          </div>
        )}
      </Card>

      <div className="mt-5">
        {inspection.sentToOfficeAt ? (
          <Card className="!bg-emerald-500/8 ring-emerald-500/20">
            <p className="text-[14px] font-semibold text-emerald-300">The office has this.</p>
            <p className="mt-1 text-[12px] leading-relaxed text-emerald-700/70">
              Sent {new Date(inspection.sentToOfficeAt).toLocaleString()}. If it is still listed as waiting to sync,
              the package is safe on this device and will go up on its own.
            </p>
            <Button variant="secondary" full className="mt-3" onClick={() => onComplete()}>
              Send the updated package
            </Button>
          </Card>
        ) : confirming ? (
          <Card>
            <SectionTitle>SEND WITHOUT THESE?</SectionTitle>
            <ul className="mt-2 space-y-1.5">
              {report.blockers.map((b) => (
                <li key={b.code} className="text-[13px] leading-relaxed text-[var(--color-ink)]/">
                  • {b.message}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-ink)]/">
              This gets recorded on the inspection so the office knows what is missing before they price it.
            </p>
            <div className="mt-3">
              <Field label="Why (optional)">
                <TextArea
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="Homeowner would not let me on the roof. Returning Thursday."
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Keep working
              </Button>
              <Button
                variant="gold"
                onClick={() => {
                  const note = overrideNote.trim()
                  onComplete({
                    codes: report.blockers.map((b) => b.code),
                    ...(note ? { note } : {}),
                  })
                }}
              >
                Send anyway
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Button
              full
              variant={report.canSend ? 'gold' : 'secondary'}
              onClick={() => (report.canSend ? onComplete() : setConfirming(true))}
            >
              {report.canSend ? 'Send to office' : `Send anyway — ${report.blockers.length} unresolved`}
            </Button>
            {report.blockers.length > 0 && (
              <p className="mt-2 text-center text-[11px] text-[var(--color-ink)]/">
                Nothing here is mandatory. You will be asked to confirm what is missing.
              </p>
            )}
            {report.warnings.length > 0 && report.canSend && (
              <p className="mt-2 text-center text-[11px] text-amber-300/70">
                {report.warnings.length} warning{report.warnings.length === 1 ? '' : 's'} will not stop you — but each
                one is a likely callback.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
