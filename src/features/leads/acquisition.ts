import { getSupabase } from '@/lib/supabase'

export type AcquisitionSource =
  | 'door'
  | 'referral'
  | 'organic'
  | 'google_ads'
  | 'meta_ads'
  | 'roofcare'
  | 'partner'
  | 'manual'
  | 'import'
  | 'other'

export type LeadTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled' | 'blocked'

export interface SetterTask {
  id: string
  leadId: string
  leadClientId: string
  address: string
  taskKind: string
  status: LeadTaskStatus
  dueAt: string | null
  reason: string
  blockedReason: string | null
  source: AcquisitionSource | null
  createdAt: string
}

export interface SourceOutcome {
  source: AcquisitionSource
  leads: number
  progressed: number
  sold: number
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export async function readSetterTasks(
  organizationId: string | null,
): Promise<{ rows: SetterTask[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !organizationId) return { rows: [], error: null }

  const { data: taskRows, error } = await supabase
    .from('lead_action_tasks')
    .select(
      'id, lead_id, task_kind, status, due_at, reason, blocked_reason, acquisition_event_id, created_at',
    )
    .eq('organization_id', organizationId)
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(200)

  if (error) return { rows: [], error: error.message }

  const rawTasks = (taskRows ?? []) as Array<Record<string, unknown>>
  const leadIds = [...new Set(rawTasks.map((row) => row['lead_id'] as string).filter(Boolean))]
  const eventIds = [
    ...new Set(
      rawTasks.map((row) => row['acquisition_event_id'] as string | null).filter(Boolean) as string[],
    ),
  ]

  const [leadResult, eventResult] = await Promise.all([
    leadIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('leads')
          .select('id, client_id, property_id')
          .eq('organization_id', organizationId)
          .in('id', leadIds),
    eventIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('lead_acquisition_events')
          .select('id, source_channel')
          .eq('organization_id', organizationId)
          .in('id', eventIds),
  ])

  if (leadResult.error) return { rows: [], error: leadResult.error.message }
  if (eventResult.error) return { rows: [], error: eventResult.error.message }

  const leads = (leadResult.data ?? []) as Array<Record<string, unknown>>
  const propertyIds = [...new Set(leads.map((row) => row['property_id'] as string).filter(Boolean))]
  const propertyResult =
    propertyIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('properties')
          .select('id, address_line1, city, state')
          .eq('organization_id', organizationId)
          .in('id', propertyIds)

  if (propertyResult.error) return { rows: [], error: propertyResult.error.message }

  const leadById = new Map(leads.map((row) => [row['id'] as string, row]))
  const propertyById = new Map(
    ((propertyResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      row['id'] as string,
      row,
    ]),
  )
  const eventById = new Map(
    ((eventResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      row['id'] as string,
      row,
    ]),
  )

  return {
    rows: rawTasks.map((row) => {
      const lead = leadById.get(row['lead_id'] as string)
      const property = lead ? propertyById.get(lead['property_id'] as string) : undefined
      const eventId = row['acquisition_event_id'] as string | null
      const event = eventId ? eventById.get(eventId) : undefined
      const address = property
        ? [property['address_line1'], property['city'], property['state']].filter(Boolean).join(', ')
        : 'Address unavailable'

      return {
        id: row['id'] as string,
        leadId: row['lead_id'] as string,
        leadClientId: (lead?.['client_id'] as string | undefined) ?? '',
        address,
        taskKind: row['task_kind'] as string,
        status: row['status'] as LeadTaskStatus,
        dueAt: (row['due_at'] as string | null) ?? null,
        reason: row['reason'] as string,
        blockedReason: (row['blocked_reason'] as string | null) ?? null,
        source: (event?.['source_channel'] as AcquisitionSource | undefined) ?? null,
        createdAt: row['created_at'] as string,
      }
    }),
    error: null,
  }
}

export async function setSetterTaskStatus(
  organizationId: string,
  taskId: string,
  status: LeadTaskStatus,
  blockedReason?: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'Server connection is unavailable.' }

  const patch: Record<string, unknown> = {
    status,
    blocked_reason: status === 'blocked' ? blockedReason?.trim() || 'Needs review' : null,
    completed_at: status === 'done' || status === 'cancelled' ? new Date().toISOString() : null,
  }

  const { error } = await supabase
    .from('lead_action_tasks')
    .update(patch)
    .eq('organization_id', organizationId)
    .eq('id', taskId)

  return { error: error?.message ?? null }
}

export async function readSourceOutcomes(
  organizationId: string | null,
): Promise<{ rows: SourceOutcome[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !organizationId) return { rows: [], error: null }

  const { data, error } = await supabase
    .from('lead_source_outcomes')
    .select('source_channel, leads, progressed, sold, first_seen_at, last_seen_at')
    .eq('organization_id', organizationId)
    .order('leads', { ascending: false })

  if (error) return { rows: [], error: error.message }

  return {
    rows: ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      source: row['source_channel'] as AcquisitionSource,
      leads: Number(row['leads'] ?? 0),
      progressed: Number(row['progressed'] ?? 0),
      sold: Number(row['sold'] ?? 0),
      firstSeenAt: (row['first_seen_at'] as string | null) ?? null,
      lastSeenAt: (row['last_seen_at'] as string | null) ?? null,
    })),
    error: null,
  }
}

export async function generateAcquisitionWebhookToken(): Promise<{
  token: string
  hash: string
  hint: string
}> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { token, hash, hint: token.slice(-4) }
}

export async function saveAcquisitionWebhookToken(
  organizationId: string,
  hash: string,
  hint: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'Server connection is unavailable.' }

  const { error } = await supabase.from('acquisition_webhook_settings').upsert(
    {
      organization_id: organizationId,
      webhook_secret_hash: hash,
      webhook_secret_hint: hint,
      webhook_rotated_at: new Date().toISOString(),
      enabled: true,
    },
    { onConflict: 'organization_id' },
  )
  return { error: error?.message ?? null }
}

export interface AcquisitionWebhookSettings {
  enabled: boolean
  secretHint: string | null
  rotatedAt: string | null
  lastReceivedAt: string | null
}

export async function readAcquisitionWebhookSettings(
  organizationId: string | null,
): Promise<{ settings: AcquisitionWebhookSettings | null; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !organizationId) return { settings: null, error: null }

  const { data, error } = await supabase
    .from('acquisition_webhook_settings')
    .select('enabled, webhook_secret_hint, webhook_rotated_at, last_received_at')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (error) return { settings: null, error: error.message }
  if (!data) return { settings: null, error: null }

  return {
    settings: {
      enabled: data.enabled === true,
      secretHint: (data.webhook_secret_hint as string | null) ?? null,
      rotatedAt: (data.webhook_rotated_at as string | null) ?? null,
      lastReceivedAt: (data.last_received_at as string | null) ?? null,
    },
    error: null,
  }
}

export async function setAcquisitionWebhookEnabled(
  organizationId: string,
  enabled: boolean,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'Server connection is unavailable.' }

  const { error } = await supabase
    .from('acquisition_webhook_settings')
    .update({ enabled })
    .eq('organization_id', organizationId)

  return { error: error?.message ?? null }
}
