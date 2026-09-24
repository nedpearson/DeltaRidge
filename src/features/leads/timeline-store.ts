import { getSupabase } from '@/lib/supabase'
import type { ContactEvent } from '@/features/leads/pipeline'
import type { LeadAttachment } from '@/features/leads/lead-store'

export type TimelineKind =
  | 'activity'
  | 'attachment'
  | 'appointment'
  | 'inspection'
  | 'estimate'
  | 'roofr'
  | 'assignment'

export interface TimelineItem {
  id: string
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
  source: 'device' | 'server' | 'roofr'
  state: 'local' | 'server'
  localEventId?: string
  localAttachmentId?: string
}

function activityTitle(type: string, outcome: string | null): string {
  if (outcome) {
    const words = outcome.replaceAll('_', ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  const words = type.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function localActivity(event: ContactEvent): TimelineItem {
  return {
    id: `activity:${event.id}`,
    at: event.at,
    kind: 'activity',
    title: activityTitle(event.kind, event.outcome ?? null),
    detail: event.note ?? null,
    source: 'device',
    state: 'local',
    localEventId: event.id,
  }
}

function localAttachment(item: LeadAttachment): TimelineItem {
  return {
    id: `attachment:${item.id}`,
    at: item.capturedAt,
    kind: 'attachment',
    title: item.kind === 'voice' ? 'Voice note recorded' : 'Photo captured',
    detail: item.kind === 'voice' && item.durationSeconds !== undefined
      ? `${item.durationSeconds}s recording`
      : null,
    source: 'device',
    state: 'local',
    localAttachmentId: item.id,
  }
}

function put(map: Map<string, TimelineItem>, item: TimelineItem): void {
  const prior = map.get(item.id)
  // A server-backed version outranks the same device record because it proves
  // that the event made the round trip. Otherwise retain whichever copy exists.
  if (!prior || (prior.state === 'local' && item.state === 'server')) map.set(item.id, item)
}

export async function readUnifiedTimeline(input: {
  organizationId: string | null
  leadClientId: string
  localHistory: readonly ContactEvent[]
  localAttachments: readonly LeadAttachment[]
}): Promise<{ items: TimelineItem[]; error: string | null }> {
  const map = new Map<string, TimelineItem>()
  for (const event of input.localHistory) put(map, localActivity(event))
  for (const attachment of input.localAttachments) put(map, localAttachment(attachment))

  const supabase = getSupabase()
  if (!supabase || !input.organizationId || !navigator.onLine) {
    return {
      items: [...map.values()].sort((a, b) => b.at.localeCompare(a.at)),
      error: null,
    }
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('client_id', input.leadClientId)
    .maybeSingle()

  if (leadError) {
    return {
      items: [...map.values()].sort((a, b) => b.at.localeCompare(a.at)),
      error: leadError.message,
    }
  }

  const remoteLeadId = (lead?.id as string | undefined) ?? null
  if (!remoteLeadId) {
    return {
      items: [...map.values()].sort((a, b) => b.at.localeCompare(a.at)),
      error: null,
    }
  }

  const [activities, attachments, appointments, inspections, estimates, roofr, assignments] =
    await Promise.all([
      supabase
        .from('activities')
        .select('id, client_id, activity_type, outcome, body, occurred_at')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('occurred_at', { ascending: false }),
      supabase
        .from('lead_attachments')
        .select('id, client_id, kind, captured_at, duration_seconds')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('captured_at', { ascending: false }),
      supabase
        .from('appointments')
        .select('id, client_id, scheduled_start, status, notes, created_at')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('scheduled_start', { ascending: false }),
      supabase
        .from('inspections')
        .select('id, client_id, status, started_at, completed_at, inspector_recommendation')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('started_at', { ascending: false }),
      supabase
        .from('estimates')
        .select('id, client_id, created_at')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('roofr_events')
        .select('id, event_type, occurred_at, received_at, status, roofr_job_id, error')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('received_at', { ascending: false }),
      supabase
        .from('lead_assignment_history')
        .select('id, action, assigned_to, actor, occurred_at')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .order('occurred_at', { ascending: false }),
    ])

  for (const row of activities.data ?? []) {
    const clientId = row.client_id as string
    put(map, {
      id: `activity:${clientId}`,
      at: row.occurred_at as string,
      kind: 'activity',
      title: activityTitle(row.activity_type as string, (row.outcome as string | null) ?? null),
      detail: (row.body as string | null) ?? null,
      source: 'server',
      state: 'server',
      localEventId: clientId,
    })
  }

  for (const row of attachments.data ?? []) {
    const clientId = row.client_id as string
    const kind = row.kind as string
    put(map, {
      id: `attachment:${clientId}`,
      at: row.captured_at as string,
      kind: 'attachment',
      title: kind === 'voice' ? 'Voice note recorded' : 'Photo captured',
      detail:
        kind === 'voice' && row.duration_seconds !== null
          ? `${Number(row.duration_seconds)}s recording`
          : null,
      source: 'server',
      state: 'server',
      localAttachmentId: clientId,
    })
  }

  for (const row of appointments.data ?? []) {
    put(map, {
      id: `appointment:${String(row.client_id ?? row.id)}`,
      at: row.created_at as string,
      kind: 'appointment',
      title: `Appointment ${String(row.status).replaceAll('_', ' ')}`,
      detail: `Scheduled ${new Date(row.scheduled_start as string).toLocaleString()}${row.notes ? ` · ${String(row.notes)}` : ''}`,
      source: 'server',
      state: 'server',
    })
  }

  for (const row of inspections.data ?? []) {
    put(map, {
      id: `inspection:${String(row.client_id ?? row.id)}`,
      at: row.started_at as string,
      kind: 'inspection',
      title: `Inspection ${String(row.status).replaceAll('_', ' ')}`,
      detail: (row.inspector_recommendation as string | null) ?? null,
      source: 'server',
      state: 'server',
    })
  }

  const estimateRows = estimates.data ?? []
  if (estimateRows.length > 0) {
    const ids = estimateRows.map((row) => row.id as string)
    const versions = await supabase
      .from('estimate_versions_sales')
      .select('estimate_id, version_number, mode, sell_price_cents, created_at')
      .in('estimate_id', ids)
      .order('created_at', { ascending: false })

    const latest = new Map<string, Record<string, unknown>>()
    for (const row of (versions.data ?? []) as unknown as Record<string, unknown>[]) {
      const estimateId = row['estimate_id'] as string
      if (!latest.has(estimateId)) latest.set(estimateId, row)
    }

    for (const row of estimateRows) {
      const version = latest.get(row.id as string)
      const cents = version?.['sell_price_cents']
      const price =
        typeof cents === 'number'
          ? ` · $${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : ''
      put(map, {
        id: `estimate:${String(row.client_id ?? row.id)}`,
        at: (version?.['created_at'] as string | undefined) ?? (row.created_at as string),
        kind: 'estimate',
        title: version
          ? `Estimate v${String(version['version_number'])} · ${String(version['mode'])}`
          : 'Estimate created',
        detail: price === '' ? null : price.slice(3),
        source: 'server',
        state: 'server',
      })
    }
  }

  for (const row of roofr.data ?? []) {
    const at = ((row.occurred_at as string | null) ?? (row.received_at as string))
    put(map, {
      id: `roofr:${String(row.id)}`,
      at,
      kind: 'roofr',
      title: `Roofr · ${String(row.event_type).replaceAll('_', ' ')}`,
      detail:
        row.error
          ? `Status: ${String(row.status)} · ${String(row.error)}`
          : row.roofr_job_id
            ? `Job ${String(row.roofr_job_id)} · ${String(row.status)}`
            : `Status: ${String(row.status)}`,
      source: 'roofr',
      state: 'server',
    })
  }

  for (const row of assignments.data ?? []) {
    put(map, {
      id: `assignment:${String(row.id)}`,
      at: row.occurred_at as string,
      kind: 'assignment',
      title: `Lead ${String(row.action).replaceAll('_', ' ')}`,
      detail: row.assigned_to ? `Assigned to ${String(row.assigned_to)}` : null,
      source: 'server',
      state: 'server',
    })
  }

  const errors = [activities, attachments, appointments, inspections, estimates, roofr, assignments]
    .flatMap((result) => (result.error ? [result.error.message] : []))

  return {
    items: [...map.values()].sort((a, b) => b.at.localeCompare(a.at)),
    error: errors.length > 0 ? errors[0] ?? null : null,
  }
}
