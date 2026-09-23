import { getSupabase } from '@/lib/supabase'
import type { ActivityRow, AssignmentOutcome, RouteRow } from './metrics'

/**
 * Reading the manager views.
 *
 * Every function here returns `null` for "could not ask" and an empty array for
 * "asked, and there is nothing". The manager screens draw those two states
 * differently, because an empty team dashboard and an unreachable server look
 * identical if you collapse them, and one of those is a rep who did no work
 * while the other is a bug.
 */

export interface TeamMember {
  userId: string
  role: string
  isActive: boolean
  fullName: string | null
}

export interface AssignmentRow {
  id: string
  leadClientId: string
  assignedTo: string
  assignedBy: string | null
  assignedAt: string
  unassignedAt: string | null
  scoreAtAssignment: number
  reason: string | null
  leadStatus: string
  address: string
  subdivision: string | null
}

export interface AuditRow {
  id: number
  action: string
  assignedTo: string | null
  actor: string | null
  scoreAtAssignment: number
  reason: string | null
  occurredAt: string
  address: string
  subdivision: string | null
}

export interface ManagerSnapshot {
  team: TeamMember[]
  activity: ActivityRow[]
  routes: RouteRow[]
  assignments: AssignmentRow[]
  audit: AuditRow[]
  /** Set when something could not be read. The screens say so rather than showing zeroes. */
  error: string | null
}

export const EMPTY_SNAPSHOT: ManagerSnapshot = {
  team: [],
  activity: [],
  routes: [],
  assignments: [],
  audit: [],
  error: null,
}

/** How far back the team numbers look, unless a screen asks for something else. */
export const DEFAULT_WINDOW_DAYS = 30

export async function readManagerSnapshot(
  orgId: string | null,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<ManagerSnapshot> {
  const supabase = getSupabase()
  if (!supabase) return { ...EMPTY_SNAPSHOT, error: 'The app is not configured for a server.' }
  if (!orgId) return { ...EMPTY_SNAPSHOT, error: 'No organization on this account yet.' }
  if (!navigator.onLine) return { ...EMPTY_SNAPSHOT, error: 'Offline — these numbers come from the server.' }

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const [team, activity, routes, assignments, audit] = await Promise.all([
    supabase.from('org_directory').select('*').eq('organization_id', orgId),
    supabase
      .from('manager_activity_rows')
      .select('*')
      .eq('organization_id', orgId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(5000),
    supabase
      .from('manager_route_rows')
      .select('*')
      .eq('organization_id', orgId)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(500),
    supabase
      .from('manager_assignment_rows')
      .select('*')
      .eq('organization_id', orgId)
      .order('assigned_at', { ascending: false })
      .limit(2000),
    supabase
      .from('manager_assignment_log')
      .select('*')
      .eq('organization_id', orgId)
      .order('occurred_at', { ascending: false })
      .limit(500),
  ])

  const failure = [team, activity, routes, assignments, audit].find((r) => r.error)
  if (failure?.error) {
    return { ...EMPTY_SNAPSHOT, error: failure.error.message }
  }

  return {
    team: (team.data ?? []).map((r) => ({
      userId: r.user_id as string,
      role: r.role as string,
      isActive: Boolean(r.is_active),
      fullName: (r.full_name as string | null) ?? null,
    })),
    activity: (activity.data ?? []).map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      activityType: r.activity_type as string,
      outcome: (r.outcome as string | null) ?? null,
      gpsVerification: (r.gps_verification as string | null) ?? null,
      occurredAt: r.occurred_at as string,
      subdivision: (r.subdivision as string | null) ?? null,
      leadClientId: r.lead_client_id as string,
    })),
    routes: (routes.data ?? []).map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      label: (r.label as string | null) ?? null,
      startedAt: r.started_at as string,
      endedAt: (r.ended_at as string | null) ?? null,
      pointCount: Number(r.point_count ?? 0),
      lastFixAt: (r.last_fix_at as string | null) ?? null,
      latitude: (r.latitude as number | null) ?? null,
      longitude: (r.longitude as number | null) ?? null,
      accuracyM: (r.accuracy_m as number | null) ?? null,
    })),
    assignments: (assignments.data ?? []).map((r) => ({
      id: r.id as string,
      leadClientId: r.lead_client_id as string,
      assignedTo: r.assigned_to as string,
      assignedBy: (r.assigned_by as string | null) ?? null,
      assignedAt: r.assigned_at as string,
      unassignedAt: (r.unassigned_at as string | null) ?? null,
      scoreAtAssignment: Number(r.lead_score_at_assignment ?? 0),
      reason: (r.reason as string | null) ?? null,
      leadStatus: r.lead_status as string,
      address: r.address_line1 as string,
      subdivision: (r.subdivision as string | null) ?? null,
    })),
    audit: (audit.data ?? []).map((r) => ({
      id: Number(r.id),
      action: r.action as string,
      assignedTo: (r.assigned_to as string | null) ?? null,
      actor: (r.actor as string | null) ?? null,
      scoreAtAssignment: Number(r.lead_score_at_assignment ?? 0),
      reason: (r.reason as string | null) ?? null,
      occurredAt: r.occurred_at as string,
      address: r.address_line1 as string,
      subdivision: (r.subdivision as string | null) ?? null,
    })),
    error: null,
  }
}

/** Assignment rows in the shape the efficiency maths wants. */
export function outcomesFrom(assignments: readonly AssignmentRow[]): AssignmentOutcome[] {
  return assignments.map((a) => ({
    repId: a.assignedTo,
    scoreAtAssignment: a.scoreAtAssignment,
    status: a.leadStatus,
  }))
}

/**
 * Hands a door to a rep, with the score frozen as it stands right now.
 *
 * The score is read at this moment and written into the row; it is never read
 * live afterwards. That is the one thing that makes the question "is this rep
 * good" answerable six months from now.
 */
export async function assignLead(input: {
  orgId: string
  leadRemoteId: string
  assignTo: string
  assignedBy: string
  score: number
  reason: string
}): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.' }

  const { error } = await supabase.from('lead_assignments').insert({
    organization_id: input.orgId,
    lead_id: input.leadRemoteId,
    assigned_to: input.assignTo,
    assigned_by: input.assignedBy,
    lead_score_at_assignment: Math.max(0, Math.min(100, Math.round(input.score))),
    score_computed_at: new Date().toISOString(),
    reason: input.reason,
  })

  if (!error) return { error: null }
  // The partial unique index. Worth naming, because "two reps at one door" is a
  // scheduling mistake a manager can fix rather than a failure they can only stare at.
  if (error.code === '23505') {
    return { error: 'That door is already assigned to somebody. Unassign it first.' }
  }
  return { error: error.message }
}

export async function unassignLead(assignmentId: string): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.' }
  const { error } = await supabase
    .from('lead_assignments')
    .update({ unassigned_at: new Date().toISOString() })
    .eq('id', assignmentId)
  return { error: error?.message ?? null }
}
