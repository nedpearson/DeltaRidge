import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Field, SectionTitle, Select, TextArea } from '@/components/ui'
import { Nothing, pct } from './shared'
import {
  CATEGORY_LABEL,
  DEFAULT_CONFIG,
  NEVER_GRADED_ON,
  effectiveGrade,
  gradeRep,
  type ComputedGrade,
  type GradingConfig,
  type StoredGrade,
} from '../grading'
import { performanceFor, pooled, type AssignedLead } from '../performance'
import { readGrades, saveComputedGrade, saveManagerGrade, type GradeRow } from '../grade-store'
import type { ActivityRow, BandRate, RouteRow } from '../metrics'

/**
 * Grading a rep, in whichever of the three modes the business chose.
 *
 * The screen is built around one refusal: the computed grade is never presented
 * as the rep's grade. In assisted mode it is a suggestion with a button to
 * accept it; in automatic mode it stands but is labelled as computed and stays
 * changeable; in manual mode it is not shown as a grade at all, only as the
 * figures behind one. A manager who accepts a suggestion is recorded as having
 * agreed with it, which is a different fact from the rubric having run, and the
 * two are stored in different columns for exactly that reason.
 */

function monthWindow(now = new Date()): { start: string; end: string; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: start.toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

export default function GradesTab({
  team,
  activity,
  routes,
  assignments,
  baseline,
  config,
  orgId,
  userId,
  canManage,
  nameOf,
}: {
  team: readonly { userId: string; role: string; isActive: boolean }[]
  activity: readonly ActivityRow[]
  routes: readonly RouteRow[]
  assignments: readonly AssignedLead[]
  baseline: readonly BandRate[]
  config: GradingConfig
  orgId: string | null
  userId: string | null
  canManage: boolean
  nameOf: (id: string | null) => string
}) {
  const period = useMemo(() => monthWindow(), [])
  const [stored, setStored] = useState<GradeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openRep, setOpenRep] = useState<string | null>(null)

  const reps = useMemo(
    () => team.filter((m) => m.isActive && m.role !== 'office').map((m) => m.userId),
    [team],
  )

  const load = useCallback(async () => {
    const result = await readGrades(orgId)
    setStored(result.grades)
    setError(result.error)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const performances = useMemo(
    () =>
      new Map(
        reps.map((repId) => [
          repId,
          performanceFor({
            repId,
            from: period.start,
            to: period.end,
            activity,
            routes,
            assignments,
            baseline,
          }),
        ]),
      ),
    [reps, activity, routes, assignments, baseline, period],
  )

  const teamContext = useMemo(() => {
    const all = [...performances.values()]
    return {
      contactRate: pooled(all.map((p) => p.doors.contactRate), 40, 'knocks'),
      appointmentRate: pooled(all.map((p) => p.doors.appointmentRate), 15, 'conversations'),
      inspectionRate: pooled(all.map((p) => p.sales.inspectionRate), 10, 'appointments'),
      contractRate: pooled(all.map((p) => p.sales.contractRate), 8, 'inspections'),
      followUpRate: pooled(all.map((p) => p.followUp.completionRate), 10, 'follow-ups'),
      knocksPerHour: pooled(all.map((p) => p.field.knocksPerFieldHour), 3, 'field hours'),
      verifiedPerHour: pooled(all.map((p) => p.field.knocksPerFieldHour), 3, 'field hours'),
      routeCompletion: pooled(
        all.map((p) => ({
          value: p.doors.assigned > 0 ? p.doors.knocked / p.doors.assigned : null,
          numerator: p.doors.knocked,
          denominator: p.doors.assigned,
          minimum: 1,
          unavailable: null,
        })),
        10,
        'assigned doors',
      ),
    }
  }, [performances])

  if (reps.length === 0) {
    return <Nothing title="Nobody to grade" body="Grades are per rep. Once somebody is on the team, they appear here." />
  }

  const gradeFor = (repId: string): GradeRow | null =>
    stored.find((g) => g.repId === repId && g.periodStart === period.start && g.period === 'monthly') ?? null

  return (
    <div className="space-y-3">
      <SectionTitle hint={period.label}>REP REVIEWS</SectionTitle>

      <Card>
        <p className="text-[12.5px] font-semibold">
          Mode: {config.mode === 'manual' ? 'Manual' : config.mode === 'assisted' ? 'Assisted' : 'Automatic'}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-white/45">
          {config.mode === 'manual'
            ? 'The figures are computed and the grade is entirely yours. Nothing is graded automatically.'
            : config.mode === 'assisted'
              ? 'A grade is suggested from the figures. It is not the rep’s grade until you accept or change it.'
              : 'A grade is computed automatically and stands until you change it. It stays labelled as computed.'}
        </p>
        <p className="mt-2 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-white/30">
          The suggestion is a published weighted rubric, not a language model — arithmetic you can check,
          with every weight and threshold on screen. It is never computed from {NEVER_GRADED_ON.join(', ')}.
        </p>
      </Card>

      {error && (
        <Card className="!bg-amber-500/8 ring-amber-500/20">
          <p className="text-[12.5px] text-amber-100/80">Grades could not be read: {error}</p>
        </Card>
      )}

      {reps.map((repId) => {
        const performance = performances.get(repId)
        if (!performance) return null
        const computed = gradeRep(performance, teamContext, config)
        const filed = gradeFor(repId)
        const shown: StoredGrade = filed ?? {
          repId,
          periodStart: period.start,
          periodEnd: period.end,
          period: 'monthly',
          mode: config.mode,
          computed: null,
          managerLetter: null,
          managerComment: null,
          managerOverrideReason: null,
          managerCategoryScores: null,
          gradedBy: null,
          gradedAt: null,
        }
        const live: StoredGrade = { ...shown, computed: shown.computed ?? computed }
        const verdict = effectiveGrade(live, config)

        return (
          <Card key={repId}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[14px] font-semibold">{nameOf(repId)}</p>
              <span className="shrink-0 font-display text-[18px] text-gold-400">
                {verdict.letter ?? '—'}
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/40">{verdict.note}</p>

            {config.mode !== 'manual' && (
              <div className="mt-2 rounded-xl bg-white/4 px-3 py-2">
                <p className="text-[12px]">
                  Suggested: <span className="font-semibold">{computed.letter ?? 'no grade'}</span>
                  {computed.score !== null && ` · ${Math.round(computed.score)}/100`}
                  {' · confidence '}
                  {pct(computed.confidence)}
                </p>
                {computed.lowConfidence && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
                    Low confidence. {pct(computed.coverage)} of the rubric could be scored and the data is{' '}
                    {pct(computed.confidenceFrom.dataCompleteness)} complete. Worth reading the breakdown
                    before using this for anything.
                  </p>
                )}
                {computed.unavailable && (
                  <p className="mt-1 text-[11px] leading-relaxed text-white/45">{computed.unavailable}</p>
                )}
              </div>
            )}

            <Button
              variant="secondary"
              full
              className="mt-2.5"
              onClick={() => setOpenRep(openRep === repId ? null : repId)}
            >
              {openRep === repId ? 'Close' : 'Review'}
            </Button>

            {openRep === repId && (
              <Review
                repId={repId}
                computed={live.computed ?? computed}
                filed={filed}
                config={config}
                canManage={canManage}
                busy={busy === repId}
                onCompute={async () => {
                  if (!orgId) return
                  setBusy(repId)
                  const result = await saveComputedGrade({
                    orgId,
                    repId,
                    period: 'monthly',
                    periodStart: period.start,
                    periodEnd: period.end,
                    mode: config.mode,
                    computed,
                  })
                  setBusy(null)
                  if (result.error) setError(result.error)
                  await load()
                }}
                onGrade={async (letter, comment, reason) => {
                  if (!orgId || !userId) return
                  setBusy(repId)
                  const result = await saveManagerGrade({
                    orgId,
                    repId,
                    period: 'monthly',
                    periodStart: period.start,
                    periodEnd: period.end,
                    mode: config.mode,
                    letter,
                    comment,
                    overrideReason: reason,
                    categoryScores: null,
                    gradedBy: userId,
                  })
                  setBusy(null)
                  if (result.error) setError(result.error)
                  await load()
                }}
              />
            )}
          </Card>
        )
      })}
    </div>
  )
}

function Review({
  computed,
  filed,
  config,
  canManage,
  busy,
  onCompute,
  onGrade,
}: {
  repId: string
  computed: ComputedGrade
  filed: GradeRow | null
  config: GradingConfig
  canManage: boolean
  busy: boolean
  onCompute: () => Promise<void>
  onGrade: (letter: string, comment: string | null, reason: string | null) => Promise<void>
}) {
  const [letter, setLetter] = useState(filed?.managerLetter ?? computed.letter ?? 'B')
  const [comment, setComment] = useState(filed?.managerComment ?? '')
  const [reason, setReason] = useState(filed?.managerOverrideReason ?? '')

  const differs = computed.letter !== null && letter !== computed.letter
  const canSubmit = canManage && !busy && (!differs || reason.trim() !== '')

  return (
    <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
      <div>
        <p className="text-[12px] font-semibold text-white/70">HOW THIS WAS WORKED OUT</p>
        <div className="mt-2 space-y-1.5">
          {computed.categories.map((category) => (
            <div key={category.key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px]">{CATEGORY_LABEL[category.key]}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-white/40">{category.evidence}</p>
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-white/60">
                {category.score === null ? 'dropped' : Math.round(category.score)}
                <span className="ml-1 text-white/30">{category.weight}%</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          A category with too thin a sample is dropped and its weight removed from the denominator, never
          filled in with an assumption. {pct(computed.coverage)} of the rubric was scorable here.
        </p>
      </div>

      {computed.strengths.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-white/70">WHAT IS WORKING</p>
          {computed.strengths.map((line) => (
            <p key={line} className="mt-1 text-[11.5px] leading-relaxed text-emerald-200/70">
              {line}
            </p>
          ))}
        </div>
      )}

      {computed.weaknesses.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-white/70">WHERE DEALS ARE GOING</p>
          {computed.weaknesses.map((line) => (
            <p key={line} className="mt-1 text-[11.5px] leading-relaxed text-amber-200/70">
              {line}
            </p>
          ))}
        </div>
      )}

      {computed.coaching.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-white/70">WHAT TO DO ABOUT IT</p>
          {computed.coaching.map((line) => (
            <p key={line} className="mt-1 text-[11.5px] leading-relaxed text-white/50">
              {line}
            </p>
          ))}
        </div>
      )}

      {!filed?.computed && config.mode !== 'manual' && canManage && (
        <Button variant="secondary" full disabled={busy} onClick={() => void onCompute()}>
          {busy ? 'Filing…' : 'File this computed grade for the period'}
        </Button>
      )}

      {filed?.computed && (
        <p className="text-[11px] leading-relaxed text-white/35">
          A computed grade is already on file for this period ({filed.computed.letter}, confidence{' '}
          {pct(filed.computed.confidence)}, engine {filed.computed.engine}). It is kept exactly as it was
          computed — the weights may have changed since, and an old grade has to keep saying what it said.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-[12px] font-semibold text-white/70">YOUR GRADE</p>
        <Field label="Grade">
          <Select value={letter} onChange={(e) => setLetter(e.target.value)} disabled={!canManage}>
            {config.scale.map((step) => (
              <option key={step.letter} value={step.letter}>
                {step.letter}
              </option>
            ))}
          </Select>
        </Field>

        {differs && (
          <Field
            label="Why you differ from the computed grade"
            hint="Required. A disagreement with no reason attached is a fact nobody can use later."
          >
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. the rubric underweighted the commercial referrals handled this month."
              disabled={!canManage}
            />
          </Field>
        )}

        <Field label="Comments for the rep">
          <TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What they did well, and the one thing to change."
            disabled={!canManage}
          />
        </Field>

        <Button
          variant="gold"
          full
          disabled={!canSubmit}
          onClick={() => void onGrade(letter, comment.trim() || null, differs ? reason.trim() : null)}
        >
          {busy ? 'Saving…' : differs && reason.trim() === '' ? 'Say why you differ' : 'Save grade'}
        </Button>

        {!canManage && (
          <p className="text-[11px] leading-relaxed text-white/35">
            Only a manager or admin can enter a grade. The server enforces that, not this screen.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-white/30">
          Your grade is stored alongside the computed one, never over it. A year from now the useful
          question is whether the rubric matched what managers actually thought, and that is unanswerable
          if accepting a suggestion overwrites it.
        </p>
      </div>
    </div>
  )
}

export { DEFAULT_CONFIG }
