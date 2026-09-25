import { useState } from 'react'
import { Button, Card, Field, SectionTitle, Select, TextInput } from '@/components/ui'
import {
  CATEGORY_LABEL,
  DEFAULT_CONFIG,
  NEVER_GRADED_ON,
  type CategoryKey,
  type GradingConfig,
  type GradingMode,
} from '../grading'
import { saveGradingConfig } from '../grade-store'

/**
 * How this business grades, set by this business.
 *
 * Weights are editable because a weighting is a statement about what Delta
 * Ridge values, and a number hard-coded in an app is a statement about what the
 * person who wrote the app values. The screen refuses to save a set that does
 * not add to 100, not out of pedantry but because weights that sum to 85 make
 * every grade quietly 15% lighter than it reads.
 */

const MODES: { id: GradingMode; label: string; detail: string }[] = [
  {
    id: 'manual',
    label: 'Manual',
    detail:
      'The figures are computed; the grade is entirely yours. Safest, and throws away the one thing a computer is better at — reading thousands of activity rows without getting bored.',
  },
  {
    id: 'assisted',
    label: 'Assisted (recommended)',
    detail:
      'A grade is suggested with its full reasoning. It is not the rep’s grade until you accept or change it. Automation where it helps, judgement where it matters.',
  },
  {
    id: 'automatic',
    label: 'Automatic',
    detail:
      'A grade is computed and stands until changed. Fastest, and it hands one rubric quiet influence over who gets the best doors — worth turning on only once you trust the figures.',
  },
]

export default function SettingsTab({
  config,
  isDefault,
  orgId,
  userId,
  canManage,
  onSaved,
}: {
  config: GradingConfig
  isDefault: boolean
  orgId: string | null
  userId: string | null
  canManage: boolean
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<GradingConfig>(config)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const total = Object.values(draft.weights).reduce((t, w) => t + w, 0)
  const balanced = Math.round(total) === 100

  const setWeight = (key: CategoryKey, value: number) => {
    setSaved(false)
    setDraft((d) => ({ ...d, weights: { ...d.weights, [key]: Math.max(0, Math.min(100, value)) } }))
  }

  return (
    <div className="space-y-3">
      <SectionTitle>GRADING</SectionTitle>

      {isDefault && (
        <Card>
          <p className="text-[12px] leading-relaxed text-[var(--color-ink)]/">
            Nothing is saved for this organisation yet, so these are the app's published defaults. They
            take effect as written; saving simply makes them yours to change.
          </p>
        </Card>
      )}

      <Card>
        <p className="text-[12px] font-semibold text-[var(--color-ink)]/">MODE</p>
        <div className="mt-2 space-y-2">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              disabled={!canManage}
              onClick={() => {
                setSaved(false)
                setDraft((d) => ({ ...d, mode: mode.id }))
              }}
              className={`w-full rounded-xl px-3 py-2.5 text-left ring-1 ${
                draft.mode === mode.id ? 'bg-gold-500/15 ring-gold-400/40' : 'bg-slate-100 hover:bg-slate-200 ring-slate-200'
              }`}
            >
              <p className="text-[13px] font-semibold">{mode.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-ink)]/">{mode.detail}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-[var(--color-ink)]/">WEIGHTS</p>
        <div className="mt-2 space-y-2">
          {(Object.keys(draft.weights) as CategoryKey[]).map((key) => (
            <div key={key} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{CATEGORY_LABEL[key]}</span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={draft.weights[key]}
                disabled={!canManage}
                onChange={(e) => setWeight(key, Number(e.target.value))}
                className="w-32 accent-gold-400"
              />
              <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-[var(--color-ink)]/">
                {draft.weights[key]}%
              </span>
            </div>
          ))}
        </div>
        <p
          className={`mt-2 text-[11.5px] ${balanced ? 'text-[var(--color-ink)]/' : 'text-amber-700/80'}`}
        >
          {balanced
            ? 'Adds to 100%.'
            : `Adds to ${total}%. Weights that do not sum to 100 make every grade quietly lighter or heavier than it reads, so this will not save until they do.`}
        </p>
        <Button
          variant="secondary"
          full
          className="mt-2"
          disabled={!canManage}
          onClick={() => {
            setSaved(false)
            setDraft((d) => ({ ...d, weights: DEFAULT_CONFIG.weights }))
          }}
        >
          Reset to the published defaults
        </Button>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-[var(--color-ink)]/">THRESHOLDS</p>
        <div className="mt-2 space-y-2">
          <Field
            label="Confidence floor"
            hint="Below this a computed grade is shown but marked as not fit to stand on its own."
          >
            <TextInput
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.minConfidence}
              disabled={!canManage}
              onChange={(e) => {
                setSaved(false)
                setDraft((d) => ({ ...d, minConfidence: Math.max(0, Math.min(1, Number(e.target.value))) }))
              }}
            />
          </Field>
          <Field label="Manager approval" hint="Whether a computed grade needs signing off before it counts.">
            <Select
              value={draft.managerApprovalRequired ? 'yes' : 'no'}
              disabled={!canManage}
              onChange={(e) => {
                setSaved(false)
                setDraft((d) => ({ ...d, managerApprovalRequired: e.target.value === 'yes' }))
              }}
            >
              <option value="yes">Required</option>
              <option value="no">Not required</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-[var(--color-ink)]/">WHAT IS NEVER GRADED ON</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-ink)]/">
          These are not options. Each one rewards something other than selling roofs — miles rewards living
          far away, app-open time rewards leaving it open, leads received rewards whoever is already
          favoured — so they appear in this system as context a person reads and never as a term in a score.
        </p>
        <ul className="mt-2 space-y-0.5">
          {NEVER_GRADED_ON.map((item) => (
            <li key={item} className="text-[11.5px] text-[var(--color-ink)]/">
              · {item}
            </li>
          ))}
        </ul>
      </Card>

      {error && (
        <Card className="!bg-amber-100 ring-amber-300">
          <p className="text-[12.5px] text-amber-100/80">{error}</p>
        </Card>
      )}

      <Button
        variant="gold"
        full
        disabled={!canManage || !balanced || busy || !orgId || !userId}
        onClick={async () => {
          if (!orgId || !userId) return
          setBusy(true)
          setError(null)
          const result = await saveGradingConfig(orgId, draft, userId)
          setBusy(false)
          if (result.error) setError(result.error)
          else {
            setSaved(true)
            onSaved()
          }
        }}
      >
        {busy ? 'Saving…' : saved ? 'Saved' : 'Save grading settings'}
      </Button>

      {!canManage && (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink)]/">
          Only a manager or admin can change this. The server refuses the write regardless of what this
          screen shows.
        </p>
      )}
    </div>
  )
}
