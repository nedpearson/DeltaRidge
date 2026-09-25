import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import { buildEstimate } from '@/features/estimating/build'
import { centsToDollars, type Cents } from '@/features/estimating/money'
import {
  DEFAULT_MARGINS,
  costsDrifted,
  estimatesForInspection,
  isUsable,
  latestVersion,
  listEstimates,
  marginPolicyFrom,
  readSettings,
  saveVersion,
  type CostSheet,
  type MarginSettings,
  type SavedEstimate,
} from '@/features/estimating/store'
import { factsFrom, seedFrom } from '@/features/estimating/from-inspection'
import { suggestScope } from '@/features/estimating/scope'
import { validateEstimate, type ValidationFlag } from '@/features/estimating/validate'
import {
  getInspection,
  listObservations,
  listPhotos,
  type LocalInspection,
  type LocalObservation,
  type LocalPhoto,
} from '@/lib/db'
import type { RoofGeometry } from '@/features/estimating/geometry'

function money(value: Cents): string {
  return centsToDollars(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

const NUMERIC_FIELDS = [
  ['areaSqFt', 'Roof area', 'SF', 'Sloped surface area, not the footprint.'],
  ['ridgeLf', 'Ridge', 'LF', ''],
  ['hipLf', 'Hip', 'LF', ''],
  ['valleyLf', 'Valley', 'LF', ''],
  ['eaveLf', 'Eave', 'LF', ''],
  ['rakeLf', 'Rake', 'LF', ''],
  ['pitchRise', 'Pitch', 'rise /12', 'The predominant slope.'],
  ['stories', 'Storeys', '', ''],
  ['eaveHeightFt', 'Eave height', 'ft', ''],
  ['existingLayers', 'Existing layers', '', 'How many roofs are on it now.'],
  ['pipeBoots', 'Pipe boots', 'count', ''],
] as const

type FieldKey = (typeof NUMERIC_FIELDS)[number][0]

const EMPTY: Record<FieldKey, string> = {
  areaSqFt: '', ridgeLf: '', hipLf: '', valleyLf: '', eaveLf: '', rakeLf: '',
  pitchRise: '6', stories: '1', eaveHeightFt: '10', existingLayers: '1', pipeBoots: '',
}

function num(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The estimating workspace.
 *
 * Deliberately one screen and no wizard. A rep is standing at a truck with a
 * measurement report; every number they have goes in, and the price appears
 * underneath. Anything the estimate could not price is shown as a gap with its
 * quantity rather than being quietly omitted or priced at zero.
 *
 * Cost, margin and the negotiation floor are internal. They are on this screen
 * because this screen is internal; nothing here is what a homeowner sees.
 */
export default function EstimatePage() {
  const { id } = useParams<{ id: string }>()
  const [form, setForm] = useState<Record<FieldKey, string>>(EMPTY)
  const [costs, setCosts] = useState<CostSheet>({})
  const [margins, setMargins] = useState<MarginSettings>(DEFAULT_MARGINS)
  const [loading, setLoading] = useState(true)
  const [inspection, setInspection] = useState<LocalInspection | null>(null)
  const [estimate, setEstimate] = useState<SavedEstimate | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [observations, setObservations] = useState<LocalObservation[]>([])

  const [allSaved, setAllSaved] = useState<readonly SavedEstimate[]>([])

  useEffect(() => {
    void readSettings().then((s) => {
      setCosts(s.costs)
      setMargins(s.margins)
      setLoading(false)
    })
    void listEstimates().then(setAllSaved)
  }, [])

  /**
   * Reopening a saved estimate. Without this, saving a roof that is not
   * attached to an inspection is a write nobody can read back - the estimate
   * sits in the database with no route to it, which is a worse outcome than
   * not saving at all because the rep believes they have it.
   */
  function reopen(saved: SavedEstimate) {
    const version = latestVersion(saved)
    if (!version) return
    setEstimate(saved)
    setForm((f) => ({ ...f, ...version.geometry }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Attaching the estimate to an inspection is the whole reason the findings
  // and photos are here rather than being retyped from memory.
  useEffect(() => {
    if (!id) return
    void (async () => {
      const [i, p, o] = await Promise.all([
        getInspection(id),
        listPhotos(id),
        listObservations(id),
      ])
      setInspection(i ?? null)
      setPhotos(p)
      setObservations(o)

      // Reopen the last saved version if there is one, so a rep returning to
      // a roof sees what they priced rather than a blank form. Otherwise seed
      // what the inspection recorded.
      const saved = await estimatesForInspection(id)
      const previous = saved[0]
      const version = previous ? latestVersion(previous) : null
      if (previous && version) {
        setEstimate(previous)
        setForm((f) => ({ ...f, ...version.geometry }))
      } else {
        setForm((f) => ({ ...f, ...seedFrom(i ?? null) }))
      }
    })().catch(() => undefined)
  }, [id])

  const set = (k: FieldKey) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const geometry: RoofGeometry = useMemo(() => {
    const area = num(form.areaSqFt)
    const boots = num(form.pipeBoots)
    return {
      facets: area > 0 ? [{ id: 'roof', areaSqFt: area, pitch: { rise: num(form.pitchRise) } }] : [],
      ridgeLf: num(form.ridgeLf),
      hipLf: num(form.hipLf),
      valleyLf: num(form.valleyLf),
      eaveLf: num(form.eaveLf),
      rakeLf: num(form.rakeLf),
      stepFlashingLf: 0,
      wallFlashingLf: 0,
      penetrations: boots > 0 ? [{ kind: 'pipe_boot', count: boots }] : [],
      stories: num(form.stories),
      eaveHeightFt: num(form.eaveHeightFt),
      existingLayers: Math.max(1, num(form.existingLayers)),
      unknowns: [],
    }
  }, [form])

  const built = useMemo(
    () => buildEstimate(geometry, costs, margins),
    [geometry, costs, margins],
  )

  const facts = useMemo(
    () => factsFrom(inspection, photos, observations, geometry),
    [inspection, photos, observations, geometry],
  )

  const suggestions = useMemo(() => (id ? suggestScope(facts) : []), [id, facts])

  const flags: readonly ValidationFlag[] = useMemo(() => {
    if (num(form.areaSqFt) <= 0) return []
    return validateEstimate({
      version: {
        id: 'draft', estimateId: id ?? 'draft', versionNumber: 1, mode: 'retail',
        lines: built.lines,
        provenance: {
          priceBookVersion: 'device', pricedAsOf: new Date().toISOString().slice(0, 10),
          wasteModelVersion: 'v1', marginPolicyVersion: 'v1',
          geometrySource: 'manual', jurisdictionRuleVersion: null,
        },
        createdAt: new Date().toISOString(), createdBy: 'rep',
      },
      facts,
      sellPrice: built.jobCost > 0 ? built.recommended.price : null,
      jobCost: built.jobCost,
      marginPolicy: marginPolicyFrom(margins),
    })
  }, [built, facts, form.areaSqFt, id, margins])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const next = await saveVersion(
        estimate?.id ?? null,
        id ?? null,
        inspection?.addressLine1 ?? 'Untitled roof',
        {
          geometry: { ...form },
          costs: { ...costs },
          margins: { ...margins },
          directCostCents: built.directCost,
          overheadCents: built.overhead,
          jobCostCents: built.jobCost,
          sellPriceCents: built.recommended.price,
          gapCount: built.gaps.length,
        },
      )
      setEstimate(next)
      setAllSaved(await listEstimates())
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? `Could not save on this device: ${err.message}`
          : 'Could not save on this device.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-[13px] text-[var(--color-ink)]/">Loading…</p>

  const hasArea = num(form.areaSqFt) > 0
  const ready = isUsable(costs)
  const saved = estimate ? latestVersion(estimate) : null
  const drifted = saved !== null && costsDrifted(saved, costs)

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl tracking-wide">Estimate</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink)]/">
          {inspection?.addressLine1
            ? inspection.addressLine1
            : 'Every number is explainable and every line says why it is there.'}
        </p>
      </div>

      {!ready && (
        <Card>
          <p className="text-[13px] leading-relaxed text-amber-700">
            Your costs are not entered yet, so nothing can be priced. This is not a setup step to
            skip — the estimator refuses to invent a price.
          </p>
          <Link to="/costs" className="mt-2 inline-block text-[13px] font-semibold text-sky-300">
            Enter your costs →
          </Link>
        </Card>
      )}

      {saved && (
        <Card>
          <p className="text-[13px] leading-relaxed text-[var(--color-ink)]/">
            Version {saved.versionNumber} saved {new Date(saved.createdAt).toLocaleString()} at{' '}
            <span className="font-semibold text-[var(--color-ink)]">{money(saved.sellPriceCents as Cents)}</span>.
          </p>
          {drifted && (
            <p className="mt-2 text-[12px] leading-relaxed text-amber-700">
              Your cost sheet has changed since this was priced. The figures below are recalculated
              at today&apos;s costs — the saved version keeps the price the homeowner was given.
              Save a new version to record the change.
            </p>
          )}
          {estimate && estimate.versions.length > 1 && (
            <p className="mt-2 text-[12px] text-[var(--color-ink)]/">
              {estimate.versions.length} versions kept. Nothing is overwritten.
            </p>
          )}
        </Card>
      )}

      {suggestions.length > 0 && (
        <>
          <SectionTitle hint={`${suggestions.length} from the inspection`}>
            WHAT THE ROOF SAID
          </SectionTitle>
          <Card>
            <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-ink)]/">
              Derived from what was actually recorded. These are suggestions, not scope — confirm
              each one before it reaches a customer.
            </p>
            <div className="space-y-3">
              {suggestions.map((s) => (
                <div key={s.key} className="border-l-2 border-sky-400/30 pl-3">
                  <p className="text-[13px] font-semibold text-[var(--color-ink)]/">
                    {s.description}
                    {s.quantity > 0 && (
                      <span className="ml-2 font-normal text-[var(--color-ink)]/">
                        {s.quantity.toFixed(s.unit === 'EA' ? 0 : 2)} {s.unit}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink)]/">{s.rationale}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--color-ink)]/">
                    {s.confidence} confidence
                    {s.needsQuantity ? ' · needs a quantity from you' : ''}
                    {s.evidence[0] ? ` · ${s.evidence[0].kind.replace(/_/g, ' ')}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <SectionTitle>MEASUREMENTS</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          {NUMERIC_FIELDS.map(([key, label, unit, help]) => (
            <Field
              key={key}
              label={unit ? `${label} (${unit})` : label}
              {...(help ? { hint: help } : {})}
            >
              <TextInput
                inputMode="decimal"
                placeholder="0"
                value={form[key]}
                onChange={set(key)}
              />
            </Field>
          ))}
        </div>
      </Card>

      {hasArea && (
        <>
          <SectionTitle hint={`${(built.waste.wasteBps / 100).toFixed(2)}% waste`}>
            MATERIAL AND LABOUR
          </SectionTitle>
          <Card>
            {built.lines.length === 0 ? (
              <p className="text-[13px] text-[var(--color-ink)]/">
                Nothing could be priced yet.
              </p>
            ) : (
              <div className="space-y-2">
                {built.lines.map((line) => (
                  <div key={line.id} className="flex items-baseline gap-3 text-[13px]">
                    <span className="flex-1 text-[var(--color-ink)]/">{line.description}</span>
                    <span className="tabular-nums text-[var(--color-ink)]/">
                      {line.quantity.toFixed(line.unit === 'EA' ? 0 : 2)} {line.unit}
                    </span>
                    <span className="w-20 text-right tabular-nums text-[var(--color-ink)]/">
                      {money(line.cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {built.gaps.length > 0 && (
            <Card>
              <p className="text-[13px] font-semibold text-amber-700">
                {built.gaps.length} item{built.gaps.length === 1 ? '' : 's'} could not be priced
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink)]/">
                These are measured and needed. They are left out rather than priced at zero, so the
                total below is short by whatever they cost.
              </p>
              <div className="mt-2 space-y-1">
                {built.gaps.map((gap) => (
                  <div key={gap.key} className="flex items-baseline gap-3 text-[13px]">
                    <span className="flex-1 text-amber-100/80">{gap.description}</span>
                    <span className="tabular-nums text-[var(--color-ink)]/">
                      {gap.quantity.toFixed(gap.unit === 'EA' ? 0 : 2)} {gap.unit}
                    </span>
                  </div>
                ))}
              </div>
              <Link to="/costs" className="mt-2 inline-block text-[13px] font-semibold text-sky-300">
                Enter the missing costs →
              </Link>
            </Card>
          )}

          {flags.length > 0 && (
            <>
              <SectionTitle
                hint={`${flags.filter((f) => f.severity === 'blocker').length} blocking`}
              >
                BEFORE THIS GOES OUT
              </SectionTitle>
              <Card>
                <div className="space-y-2">
                  {flags.map((flag, i) => (
                    <div key={`${flag.code}-${i}`} className="flex gap-2 text-[13px] leading-relaxed">
                      <span
                        className={
                          flag.severity === 'blocker'
                            ? 'shrink-0 font-semibold text-rose-300'
                            : flag.severity === 'warning'
                              ? 'shrink-0 font-semibold text-amber-300'
                              : 'shrink-0 font-semibold text-[var(--color-ink)]/'
                        }
                      >
                        {flag.severity === 'blocker' ? 'STOP' : flag.severity === 'warning' ? 'CHECK' : 'NOTE'}
                      </span>
                      <span className="text-[var(--color-ink)]/">{flag.message}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          <SectionTitle hint="internal — never shown to a homeowner">COST AND PRICE</SectionTitle>
          <Card>
            <div className="space-y-2 text-[13px]">
              <Row label="Direct cost" value={money(built.directCost)} />
              <Row label="Overhead" value={money(built.overhead)} />
              <Row label="Job cost" value={money(built.jobCost)} strong />
              <div className="my-2 h-px bg-slate-200" />
              <Row
                label={`Recommended (${(built.recommended.realisedMargin / 100).toFixed(1)}% margin)`}
                value={money(built.recommended.price)}
                strong
              />
              <Row label="Commission" value={money(built.recommended.commission)} />
              <Row label="Gross profit" value={money(built.recommended.grossProfit)} />
            </div>
          </Card>

          <SectionTitle hint="internal">NEGOTIATION</SectionTitle>
          <Card>
            <div className="space-y-2 text-[13px]">
              <Row label="Standard" value={money(built.ladder.standard)} />
              <Row label="Target" value={money(built.ladder.target)} />
              <Row label="Manager floor" value={money(built.ladder.floor)} />
              <Row label="Stop — decline below this" value={money(built.ladder.stop)} strong />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-ink)]/">
              Every rung already has commission taken out of it, so each one leaves the margin it
              is named for. A rung priced without commission would look lower and quietly miss its
              margin by the whole commission.
            </p>
          </Card>

          <SectionTitle>WHY EACH LINE IS THERE</SectionTitle>
          <Card>
            <div className="space-y-2">
              {built.lines.map((line) => (
                <div key={line.id} className="text-[12px] leading-relaxed">
                  <span className="text-[var(--color-ink)]/">{line.description}</span>
                  <span className="text-[var(--color-ink)]/"> — {line.reason.replace(/_/g, ' ')}</span>
                  {line.evidence[0] && (
                    <span className="text-[var(--color-ink)]/"> · {line.evidence[0].summary}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {!hasArea && (
        <Card>
          <p className="text-[13px] text-[var(--color-ink)]/">
            Enter the roof area to price it.
          </p>
        </Card>
      )}

      {saveError && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-700 ring-1 ring-amber-300">
          {saveError}
        </p>
      )}

      {hasArea && (
        <Button full onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : estimate ? 'Save a new version' : 'Save this estimate'}
        </Button>
      )}

      <Button full onClick={() => setForm(EMPTY)}>Clear</Button>

      {allSaved.length > 0 && (
        <>
          <SectionTitle hint={`${allSaved.length} kept`}>SAVED ESTIMATES</SectionTitle>
          <Card>
            <div className="space-y-2">
              {allSaved.map((s) => {
                const v = latestVersion(s)
                const open = estimate?.id === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => reopen(s)}
                    className="flex w-full items-baseline gap-3 text-left text-[13px]"
                  >
                    <span className={`flex-1 truncate ${open ? 'text-sky-700' : 'text-[var(--color-ink)]/'}`}>
                      {s.label}
                      {open && ' · open'}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-ink)]/">
                      v{v?.versionNumber ?? 0} · {new Date(s.updatedAt).toLocaleDateString()}
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums text-[var(--color-ink)]/">
                      {v ? money(v.sellPriceCents as Cents) : '—'}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className={`flex-1 ${strong ? 'text-[var(--color-ink)]/' : 'text-[var(--color-ink)]/'}`}>{label}</span>
      <span
        className={`tabular-nums ${strong ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink)]/'}`}
      >
        {value}
      </span>
    </div>
  )
}
