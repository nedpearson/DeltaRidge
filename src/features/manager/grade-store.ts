import { getSupabase } from '@/lib/supabase'
import {
  DEFAULT_CONFIG,
  DEFAULT_SCALE,
  DEFAULT_WEIGHTS,
  type ComputedGrade,
  type GradeStep,
  type GradingConfig,
  type GradingMode,
  type StoredGrade,
  type Weights,
} from './grading'

/**
 * Reading and writing grades.
 *
 * Two rules, both about not losing what was decided.
 *
 * A computed grade is written ONCE per period. The server refuses to let it be
 * edited afterwards, so this module never tries: re-running the rubric on a
 * period that already has one leaves the stored computation alone and reports
 * that it did. What the manager writes is a separate set of columns, written
 * separately, and accepting a suggestion records agreement rather than
 * replacing anything.
 *
 * Everything returns a stated reason on failure. A grading screen that silently
 * shows nothing when the server is unreachable is a screen that looks exactly
 * like a rep who did no work.
 */

export interface GradeConfigResult {
  config: GradingConfig
  /** True when this is the published default rather than anything saved. */
  isDefault: boolean
  error: string | null
}

export async function readGradingConfig(orgId: string | null): Promise<GradeConfigResult> {
  const supabase = getSupabase()
  if (!supabase || !orgId) {
    return { config: DEFAULT_CONFIG, isDefault: true, error: null }
  }

  const { data, error } = await supabase
    .from('grading_configs')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return { config: DEFAULT_CONFIG, isDefault: true, error: error.message }
  if (!data) return { config: DEFAULT_CONFIG, isDefault: true, error: null }

  return {
    config: {
      mode: data.mode as GradingMode,
      // A saved config missing a key falls back to the published default for
      // that key rather than to zero, which would silently drop a category out
      // of every grade the moment a new one is added to the app.
      weights: { ...DEFAULT_WEIGHTS, ...((data.weights ?? {}) as Partial<Weights>) },
      scale: Array.isArray(data.scale) && data.scale.length > 0 ? (data.scale as GradeStep[]) : DEFAULT_SCALE,
      minConfidence: typeof data.min_confidence === 'number' ? data.min_confidence : DEFAULT_CONFIG.minConfidence,
      managerApprovalRequired: data.manager_approval_required !== false,
    },
    isDefault: false,
    error: null,
  }
}

export async function saveGradingConfig(
  orgId: string,
  config: GradingConfig,
  updatedBy: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.' }

  const { error } = await supabase.from('grading_configs').upsert(
    {
      organization_id: orgId,
      mode: config.mode,
      weights: config.weights,
      scale: config.scale,
      min_confidence: config.minConfidence,
      manager_approval_required: config.managerApprovalRequired,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' },
  )
  // RLS decides this, not the front end. A salesperson who reaches this call is
  // refused by the server, which is the only place a permission is real.
  if (error) return { error: error.message }
  return { error: null }
}

/**
 * Whether two timestamps are the same moment, whatever they look like.
 *
 * Postgres returns a timestamptz as `2026-09-01 00:00:00+00`; the client builds
 * `2026-09-01T00:00:00.000Z`. Same instant, different strings — and comparing
 * them with `===` silently never matched, so a grade that saved perfectly well
 * left the screen still showing no grade. That reads exactly like a save that
 * failed, which is the worst way for a write path to be wrong.
 */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) && x === y
}

/** The grade filed for one rep and one period, matched by instant. */
export function findGrade(
  grades: readonly GradeRow[],
  repId: string,
  period: StoredGrade['period'],
  periodStart: string,
): GradeRow | null {
  return (
    grades.find(
      (g) => g.repId === repId && g.period === period && sameInstant(g.periodStart, periodStart),
    ) ?? null
  )
}

export interface GradeRow extends StoredGrade {
  id: string
  createdAt: string
}

function toGrade(row: Record<string, unknown>): GradeRow {
  return {
    id: row.id as string,
    repId: row.rep_id as string,
    period: row.period as StoredGrade['period'],
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    mode: row.mode as GradingMode,
    computed: (row.ai_detail as ComputedGrade | null) ?? null,
    managerLetter: (row.manager_letter as string | null) ?? null,
    managerComment: (row.manager_comment as string | null) ?? null,
    managerOverrideReason: (row.manager_override_reason as string | null) ?? null,
    managerCategoryScores:
      (row.manager_category_scores as StoredGrade['managerCategoryScores']) ?? null,
    gradedBy: (row.graded_by as string | null) ?? null,
    gradedAt: (row.graded_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}

export async function readGrades(
  orgId: string | null,
  limit = 200,
): Promise<{ grades: GradeRow[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { grades: [], error: 'The app is not configured for a server.' }
  if (!orgId) return { grades: [], error: 'No organization on this account yet.' }

  const { data, error } = await supabase
    .from('rep_grades')
    .select('*')
    .eq('organization_id', orgId)
    .order('period_start', { ascending: false })
    .limit(limit)

  if (error) return { grades: [], error: error.message }
  return { grades: (data ?? []).map((r) => toGrade(r as Record<string, unknown>)), error: null }
}

/**
 * Files a computed grade for a period.
 *
 * Refuses rather than overwrites when one already exists. The server would
 * refuse anyway — the freeze trigger is the real guard — and doing it here too
 * means the screen can say why instead of surfacing a Postgres exception.
 */
export async function saveComputedGrade(input: {
  orgId: string
  repId: string
  period: StoredGrade['period']
  periodStart: string
  periodEnd: string
  mode: GradingMode
  computed: ComputedGrade
}): Promise<{ error: string | null; alreadyExists: boolean }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.', alreadyExists: false }

  const { data: existing } = await supabase
    .from('rep_grades')
    .select('id, ai_detail')
    .eq('organization_id', input.orgId)
    .eq('rep_id', input.repId)
    .eq('period', input.period)
    .eq('period_start', input.periodStart)
    .maybeSingle()

  if (existing?.ai_detail) {
    return {
      error:
        'This period already has a computed grade. It is kept as it was — the weights may have changed since, and an old grade has to keep saying what it said.',
      alreadyExists: true,
    }
  }

  const row = {
    organization_id: input.orgId,
    rep_id: input.repId,
    period: input.period,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    mode: input.mode,
    engine: input.computed.engine,
    ai_score: input.computed.score,
    ai_letter: input.computed.letter,
    ai_confidence: input.computed.confidence,
    ai_detail: input.computed,
    computed_at: new Date().toISOString(),
  }

  const { error } = existing?.id
    ? await supabase.from('rep_grades').update(row).eq('id', existing.id)
    : await supabase.from('rep_grades').insert(row)

  if (error) return { error: error.message, alreadyExists: false }
  return { error: null, alreadyExists: false }
}

/**
 * The manager's grade.
 *
 * Written into its own columns. Nothing here touches the computed ones, and the
 * server's freeze trigger would refuse if it tried. `overrideReason` is
 * required when there is a computed grade to differ from, because "the manager
 * disagreed" with no reason attached is a fact nobody can use later.
 */
export async function saveManagerGrade(input: {
  orgId: string
  repId: string
  period: StoredGrade['period']
  periodStart: string
  periodEnd: string
  mode: GradingMode
  letter: string
  comment: string | null
  overrideReason: string | null
  categoryScores: StoredGrade['managerCategoryScores']
  gradedBy: string
}): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.' }

  const { data: existing } = await supabase
    .from('rep_grades')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('rep_id', input.repId)
    .eq('period', input.period)
    .eq('period_start', input.periodStart)
    .maybeSingle()

  const fields = {
    manager_letter: input.letter,
    manager_comment: input.comment,
    manager_override_reason: input.overrideReason,
    manager_category_scores: input.categoryScores,
    graded_by: input.gradedBy,
    graded_at: new Date().toISOString(),
  }

  const { error } = existing?.id
    ? await supabase.from('rep_grades').update(fields).eq('id', existing.id)
    : await supabase.from('rep_grades').insert({
        organization_id: input.orgId,
        rep_id: input.repId,
        period: input.period,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        mode: input.mode,
        ...fields,
      })

  if (error) return { error: error.message }
  return { error: null }
}

export interface GradeEvent {
  id: number
  repId: string
  action: string
  actor: string | null
  aiLetter: string | null
  managerLetter: string | null
  reason: string | null
  occurredAt: string
}

export async function readGradeEvents(
  orgId: string | null,
  limit = 200,
): Promise<{ events: GradeEvent[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !orgId) return { events: [], error: null }

  const { data, error } = await supabase
    .from('rep_grade_events')
    .select('*')
    .eq('organization_id', orgId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) return { events: [], error: error.message }
  return {
    events: (data ?? []).map((r) => ({
      id: Number(r.id),
      repId: r.rep_id as string,
      action: r.action as string,
      actor: (r.actor as string | null) ?? null,
      aiLetter: (r.ai_letter as string | null) ?? null,
      managerLetter: (r.manager_letter as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      occurredAt: r.occurred_at as string,
    })),
    error: null,
  }
}
