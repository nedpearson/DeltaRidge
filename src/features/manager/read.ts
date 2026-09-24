import { getSupabase } from '@/lib/supabase'
import type { RoutePoint } from '@/features/routes/route-store'
import type { ActivityRow, AssignmentOutcome, RouteRow } from './metrics'
import type { AssignedLead } from './performance'

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
      firstFixAt: (r.first_fix_at as string | null) ?? null,
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

/**
 * The whole trail of one route, for replaying it.
 *
 * Read one session at a time, deliberately. `manager_route_rows` carries only
 * the last fix because a live status board does not need everyone's whole day,
 * and handing out every point of every rep's week to draw a summary screen is a
 * different question from "where is this person now".
 */
export async function readRoutePoints(
  orgId: string | null,
  sessionId: string,
): Promise<{ points: RoutePoint[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { points: [], error: 'The app is not configured for a server.' }
  if (!orgId) return { points: [], error: 'No organization on this account yet.' }

  const { data, error } = await supabase
    .from('route_point_rows')
    .select('*')
    .eq('organization_id', orgId)
    .eq('route_session_id', sessionId)
    .order('recorded_at', { ascending: true })
    .limit(20_000)

  if (error) return { points: [], error: error.message }

  return {
    points: (data ?? []).map((r, index) => ({
      // The trail is read-only here, so the local id is positional. Nothing
      // downstream writes these back.
      id: `${sessionId}-${index}`,
      sessionId,
      recordedAt: r.recorded_at as string,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      ...(r.accuracy_m !== null ? { accuracyMeters: Number(r.accuracy_m) } : {}),
      ...(r.altitude_m !== null ? { altitudeMeters: Number(r.altitude_m) } : {}),
      ...(r.speed_mps !== null ? { speedMps: Number(r.speed_mps) } : {}),
      ...(r.heading_deg !== null ? { headingDeg: Number(r.heading_deg) } : {}),
    })),
    error: null,
  }
}

export interface FollowupRow {
  leadClientId: string
  status: string
  nextActionAt: string | null
  lastActivityAt: string | null
  score: number
  subdivision: string | null
  address: string
}

/** What every lead is waiting on, for the follow-up figures. */
export async function readFollowups(
  orgId: string | null,
): Promise<{ rows: FollowupRow[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !orgId) return { rows: [], error: null }

  const { data, error } = await supabase
    .from('manager_lead_followups')
    .select('*')
    .eq('organization_id', orgId)
    .limit(5000)

  if (error) return { rows: [], error: error.message }
  return {
    rows: (data ?? []).map((r) => ({
      leadClientId: r.lead_client_id as string,
      status: r.lead_status as string,
      nextActionAt: (r.next_action_at as string | null) ?? null,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
      score: Number(r.opportunity_score ?? 0),
      subdivision: (r.subdivision as string | null) ?? null,
      address: (r.address_line1 as string | null) ?? '',
    })),
    error: null,
  }
}

/**
 * Assigned doors in the shape the performance engine wants, with the follow-up
 * dates joined on.
 *
 * The join is done here rather than in SQL because the two views answer to
 * different RLS paths and a database join would quietly return the intersection
 * — which on a rep's own device is a shorter list than the truth.
 */
export function assignedLeads(
  assignments: readonly AssignmentRow[],
  followups: readonly FollowupRow[],
): AssignedLead[] {
  const byLead = new Map(followups.map((f) => [f.leadClientId, f]))
  return assignments
    .filter((a) => !a.unassignedAt)
    .map((a) => {
      const followup = byLead.get(a.leadClientId)
      return {
        repId: a.assignedTo,
        leadClientId: a.leadClientId,
        scoreAtAssignment: a.scoreAtAssignment,
        assignedAt: a.assignedAt,
        status: a.leadStatus,
        nextActionAt: followup?.nextActionAt ?? null,
        lastActivityAt: followup?.lastActivityAt ?? null,
        subdivision: a.subdivision,
      }
    })
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
