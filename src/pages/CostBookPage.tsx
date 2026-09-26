import { useEffect, useState } from 'react'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import {
  COST_ENTRIES,
  DEFAULT_MARGINS,
  ESSENTIAL_COSTS,
  isUsable,
  readSettings,
  writeSettings,
  type CostKey,
  type CostSheet,
  type MarginSettings,
} from '@/features/estimating/store'

/**
 * Delta Ridge's own costs, entered once.
 *
 * Nothing here ships with a value. A plausible default would make the
 * estimator produce a finished-looking number for a roof nobody has priced,
 * and that number would be wrong in a way no one could see. An empty field
 * gets filled in; an invented one gets trusted.
 *
 * Margins are different and ARE defaulted, because a margin is a policy the
 * company chooses and can see on screen, while a cost is a fact only the
 * supplier invoice knows.
 */
export default function CostBookPage() {
  const [costs, setCosts] = useState<CostSheet>({})
  const [margins, setMargins] = useState<MarginSettings>(DEFAULT_MARGINS)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void readSettings().then((s) => {
      setCosts(s.costs)
      setMargins(s.margins)
      setSavedAt(s.updatedAt)
      setLoading(false)
    })
  }, [])

  const [saveError, setSaveError] = useState<string | null>(null)

  async function save() {
    try {
      const at = await writeSettings(costs, margins)
      setSavedAt(at)
      setSaveError(null)
    } catch (err) {
      // Silently losing a cost sheet the owner just typed out is the worst
      // outcome here: they would go estimate a roof believing it was saved.
      setSaveError(
        err instanceof Error
          ? `Could not save on this device: ${err.message}`
          : 'Could not save on this device.',
      )
    }
  }

  const setCost = (key: CostKey) => (e: { target: { value: string } }) => {
    const raw = e.target.value.trim()
    setCosts((c) => {
      const next = { ...c }
      if (raw === '') delete next[key]
      else next[key] = Number(raw)
      return next
    })
  }

  const setMargin = (key: keyof MarginSettings) => (e: { target: { value: string } }) =>
    setMargins((m) => ({ ...m, [key]: Number(e.target.value) }))

  if (loading) return <p className="text-[13px] text-text-secondary">Loading…</p>

  const ready = isUsable(costs)
  const missingEssential = ESSENTIAL_COSTS.filter((k) => {
    const v = costs[k]
    return v === undefined || !Number.isFinite(v) || v <= 0
  })

  const groups: Array<[string, typeof COST_ENTRIES]> = [
    ['MATERIAL', COST_ENTRIES.filter((e) => e.category === 'material')],
    ['LABOUR', COST_ENTRIES.filter((e) => e.category === 'labor')],
    ['PER JOB', COST_ENTRIES.filter((e) => e.category === 'other')],
  ]

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl tracking-wide">Your costs</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          What Delta Ridge actually pays. Nothing is filled in for you on purpose — an invented
          cost prices a roof without anyone noticing. Read these off a recent supplier invoice
          and your crew or subcontract rate.
        </p>
      </div>

      <Card>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {ready ? (
            <>Ready to estimate. {savedAt ? `Saved ${new Date(savedAt).toLocaleString()}.` : ''}</>
          ) : (
            <>
              {missingEssential.length} essential figure{missingEssential.length === 1 ? '' : 's'}{' '}
              still needed before an estimate can be priced.
            </>
          )}
        </p>
      </Card>

      {groups.map(([title, entries]) => (
        <div key={title}>
          <SectionTitle>{title}</SectionTitle>
          <Card>
            <div className="space-y-3">
              {entries.map((entry) => (
                <Field key={entry.key} label={`${entry.label} (${entry.unit})`} hint={entry.help}>
                  <TextInput
                    inputMode="decimal"
                    placeholder="not entered"
                    value={costs[entry.key] === undefined ? '' : String(costs[entry.key])}
                    onChange={setCost(entry.key)}
                  />
                </Field>
              ))}
            </div>
          </Card>
        </div>
      ))}

      <SectionTitle hint="internal">MARGIN AND OVERHEAD</SectionTitle>
      <Card>
        <div className="space-y-3">
          <Field label="Standard margin (%)" hint="What you price at by default.">
            <TextInput inputMode="decimal" value={String(margins.standardPercent)}
              onChange={setMargin('standardPercent')} />
          </Field>
          <Field label="Target margin (%)" hint="A rep may drop to here without asking.">
            <TextInput inputMode="decimal" value={String(margins.targetPercent)}
              onChange={setMargin('targetPercent')} />
          </Field>
          <Field label="Floor margin (%)" hint="A manager may approve down to here.">
            <TextInput inputMode="decimal" value={String(margins.floorPercent)}
              onChange={setMargin('floorPercent')} />
          </Field>
          <Field label="Stop margin (%)" hint="Below this the job is declined. Nothing overrides it.">
            <TextInput inputMode="decimal" value={String(margins.stopPercent)}
              onChange={setMargin('stopPercent')} />
          </Field>
          <Field label="Overhead (%)" hint="Recovered as a share of direct job cost.">
            <TextInput inputMode="decimal" value={String(margins.overheadPercent)}
              onChange={setMargin('overheadPercent')} />
          </Field>
          <Field label="Commission (%)" hint="A share of the selling price, so it is solved for, not added on.">
            <TextInput inputMode="decimal" value={String(margins.commissionPercent)}
              onChange={setMargin('commissionPercent')} />
          </Field>
        </div>
      </Card>

      {saveError && (
        <p className="rounded-lg bg-status-warning px-3 py-2 text-[13px] text-status-warning ring-1 ring-amber-300">
          {saveError}
        </p>
      )}

      <Button full onClick={() => void save()}>Save</Button>
    </div>
  )
}
