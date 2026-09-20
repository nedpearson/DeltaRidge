import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import { buildEstimate } from '@/features/estimating/build'
import { centsToDollars, type Cents } from '@/features/estimating/money'
import {
  DEFAULT_MARGINS,
  isUsable,
  readSettings,
  type CostSheet,
  type MarginSettings,
} from '@/features/estimating/store'
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
  const [form, setForm] = useState<Record<FieldKey, string>>(EMPTY)
  const [costs, setCosts] = useState<CostSheet>({})
  const [margins, setMargins] = useState<MarginSettings>(DEFAULT_MARGINS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void readSettings().then((s) => {
      setCosts(s.costs)
      setMargins(s.margins)
      setLoading(false)
    })
  }, [])

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

  if (loading) return <p className="text-[13px] text-white/45">Loading…</p>

  const hasArea = num(form.areaSqFt) > 0
  const ready = isUsable(costs)

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl tracking-wide">Estimate</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-white/45">
          Every number is explainable and every line says why it is there.
        </p>
      </div>

      {!ready && (
        <Card>
          <p className="text-[13px] leading-relaxed text-amber-200">
            Your costs are not entered yet, so nothing can be priced. This is not a setup step to
            skip — the estimator refuses to invent a price.
          </p>
          <Link to="/costs" className="mt-2 inline-block text-[13px] font-semibold text-sky-300">
            Enter your costs →
          </Link>
        </Card>
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
              <p className="text-[13px] text-white/45">
                Nothing could be priced yet.
              </p>
            ) : (
              <div className="space-y-2">
                {built.lines.map((line) => (
                  <div key={line.id} className="flex items-baseline gap-3 text-[13px]">
                    <span className="flex-1 text-white/80">{line.description}</span>
                    <span className="tabular-nums text-white/45">
                      {line.quantity.toFixed(line.unit === 'EA' ? 0 : 2)} {line.unit}
                    </span>
                    <span className="w-20 text-right tabular-nums text-white/80">
                      {money(line.cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {built.gaps.length > 0 && (
            <Card>
              <p className="text-[13px] font-semibold text-amber-200">
                {built.gaps.length} item{built.gaps.length === 1 ? '' : 's'} could not be priced
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-white/50">
                These are measured and needed. They are left out rather than priced at zero, so the
                total below is short by whatever they cost.
              </p>
              <div className="mt-2 space-y-1">
                {built.gaps.map((gap) => (
                  <div key={gap.key} className="flex items-baseline gap-3 text-[13px]">
                    <span className="flex-1 text-amber-100/80">{gap.description}</span>
                    <span className="tabular-nums text-white/45">
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

          <SectionTitle hint="internal — never shown to a homeowner">COST AND PRICE</SectionTitle>
          <Card>
            <div className="space-y-2 text-[13px]">
              <Row label="Direct cost" value={money(built.directCost)} />
              <Row label="Overhead" value={money(built.overhead)} />
              <Row label="Job cost" value={money(built.jobCost)} strong />
              <div className="my-2 h-px bg-white/10" />
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
            <p className="mt-3 text-[12px] leading-relaxed text-white/45">
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
                  <span className="text-white/70">{line.description}</span>
                  <span className="text-white/35"> — {line.reason.replace(/_/g, ' ')}</span>
                  {line.evidence[0] && (
                    <span className="text-white/35"> · {line.evidence[0].summary}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {!hasArea && (
        <Card>
          <p className="text-[13px] text-white/45">
            Enter the roof area to price it.
          </p>
        </Card>
      )}

      <Button full onClick={() => setForm(EMPTY)}>Clear</Button>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className={`flex-1 ${strong ? 'text-white/85' : 'text-white/55'}`}>{label}</span>
      <span
        className={`tabular-nums ${strong ? 'font-semibold text-white' : 'text-white/70'}`}
      >
        {value}
      </span>
    </div>
  )
}
