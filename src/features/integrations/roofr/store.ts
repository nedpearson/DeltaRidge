import { getSupabase } from '@/lib/supabase'

/**
 * The app's side of the Roofr connection.
 *
 * Deliberately thin. Everything that could create a record in somebody's CRM,
 * and every credential that could let a stranger do the same, lives in an Edge
 * Function; this module reads state and asks the server to act. The phone never
 * holds the Zapier hook URL and never holds a Roofr token, because a phone in a
 * truck is not a place to keep a key to the company's job board.
 */

export type PushThreshold =
  | 'manual_only'
  | 'lead_created'
  | 'contacted'
  | 'interested'
  | 'inspection_scheduled'
  | 'manager_approved'

export interface RoofrSettings {
  readonly organizationId: string
  readonly pushEnabled: boolean
  readonly pushAutomatic: boolean
  readonly pushThreshold: PushThreshold
  readonly stageMap: Readonly<Record<string, string>>
  readonly connectedAt: string | null
  readonly lastInboundAt: string | null
  readonly lastOutboundAt: string | null
  /** Last four characters of the webhook token. Null means none is set. */
  readonly secretHint: string | null
  readonly secretRotatedAt: string | null
}

export interface RoofrLink {
  readonly leadId: string
  readonly roofrJobId: string | null
  readonly roofrCustomerId: string | null
  readonly workflowStage: string | null
  readonly reportOrderedAt: string | null
  readonly proposalSentAt: string | null
  readonly proposalViewedAt: string | null
  readonly proposalSignedAt: string | null
  readonly proposalLostAt: string | null
  readonly proposalTotalCents: number | null
  readonly lastEventAt: string | null
}

export interface SyncRow {
  readonly id: string
  readonly direction: 'inbound' | 'outbound'
  readonly what: string
  readonly status: string
  readonly at: string
  readonly leadId: string | null
  readonly error: string | null
  readonly attempts: number | null
}

/**
 * Generate a webhook credential, and hand back the only copy.
 *
 * The token is made here, in the browser, and only its SHA-256 is stored. That
 * means nobody — not an admin reading the table, not support, not this code on
 * a later visit — can recover it. The caller shows it once and it is gone, which
 * is inconvenient exactly in proportion to how much damage a leaked copy of it
 * would do: anyone holding it can post events into this company's leads.
 */
export async function generateWebhookToken(): Promise<{ token: string; hash: string; hint: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return { token, hash, hint: token.slice(-4) }
}

/**
 * Supabase's generated types are not wired up in this project, so a select with
 * an explicit column list infers as an error shape rather than a row. Casting
 * once here keeps the column lists — which are worth having, a phone on a truck
 * should not download columns nobody reads — without scattering casts through
 * every field access below.
 */
function row(value: unknown): Record<string, unknown> | null {
  return value === null || value === undefined ? null : (value as Record<string, unknown>)
}

export async function readSettings(organizationId: string): Promise<RoofrSettings | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data } = await supabase
    .from('roofr_settings')
    .select(
      'organization_id, push_enabled, push_automatic, push_threshold, stage_map, ' +
        'connected_at, last_inbound_at, last_outbound_at, webhook_secret_hint, webhook_rotated_at',
    )
    .eq('organization_id', organizationId)
    .maybeSingle()
  const settings = row(data)
  if (!settings) return null
  return {
    organizationId: settings['organization_id'] as string,
    pushEnabled: settings['push_enabled'] === true,
    pushAutomatic: settings['push_automatic'] === true,
    pushThreshold: (settings['push_threshold'] as PushThreshold) ?? 'inspection_scheduled',
    stageMap: (settings['stage_map'] as Record<string, string>) ?? {},
    connectedAt: (settings['connected_at'] as string | null) ?? null,
    lastInboundAt: (settings['last_inbound_at'] as string | null) ?? null,
    lastOutboundAt: (settings['last_outbound_at'] as string | null) ?? null,
    secretHint: (settings['webhook_secret_hint'] as string | null) ?? null,
    secretRotatedAt: (settings['webhook_rotated_at'] as string | null) ?? null,
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export async function saveSettings(
  organizationId: string,
  patch: {
    pushEnabled?: boolean
    pushAutomatic?: boolean
    pushThreshold?: PushThreshold
    stageMap?: Record<string, string>
    secretHash?: string
    secretHint?: string
  },
): Promise<SaveResult> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'No connection to the server.' }

  const row: Record<string, unknown> = { organization_id: organizationId }
  if (patch.pushEnabled !== undefined) row['push_enabled'] = patch.pushEnabled
  if (patch.pushAutomatic !== undefined) row['push_automatic'] = patch.pushAutomatic
  if (patch.pushThreshold !== undefined) row['push_threshold'] = patch.pushThreshold
  if (patch.stageMap !== undefined) row['stage_map'] = patch.stageMap
  if (patch.secretHash !== undefined) {
    row['webhook_secret_hash'] = patch.secretHash
    row['webhook_secret_hint'] = patch.secretHint ?? null
    row['webhook_rotated_at'] = new Date().toISOString()
    row['connected_at'] = new Date().toISOString()
  }

  const { error } = await supabase.from('roofr_settings').upsert(row, { onConflict: 'organization_id' })
  // The message is shown, not swallowed. A 403 here means the RLS policy did its
  // job and the person is not a manager; silently doing nothing would read as a
  // broken button.
  return error ? { ok: false, error: error.message } : { ok: true }
}

async function remoteLeadIdForClientId(
  organizationId: string,
  leadClientId: string,
): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('client_id', leadClientId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return (data.id as string | null) ?? null
}

export async function readLink(
  organizationId: string,
  leadClientId: string,
): Promise<RoofrLink | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const leadId = await remoteLeadIdForClientId(organizationId, leadClientId)
  if (!leadId) return null
  const { data } = await supabase
    .from('roofr_links')
    .select(
      'lead_id, roofr_job_id, roofr_customer_id, workflow_stage, report_ordered_at, ' +
        'proposal_sent_at, proposal_viewed_at, proposal_signed_at, proposal_lost_at, ' +
        'proposal_total_cents, last_event_at',
    )
    .eq('lead_id', leadId)
    .maybeSingle()
  const link = row(data)
  if (!link) return null
  return {
    leadId: link['lead_id'] as string,
    roofrJobId: (link['roofr_job_id'] as string | null) ?? null,
    roofrCustomerId: (link['roofr_customer_id'] as string | null) ?? null,
    workflowStage: (link['workflow_stage'] as string | null) ?? null,
    reportOrderedAt: (link['report_ordered_at'] as string | null) ?? null,
    proposalSentAt: (link['proposal_sent_at'] as string | null) ?? null,
    proposalViewedAt: (link['proposal_viewed_at'] as string | null) ?? null,
    proposalSignedAt: (link['proposal_signed_at'] as string | null) ?? null,
    proposalLostAt: (link['proposal_lost_at'] as string | null) ?? null,
    proposalTotalCents: (link['proposal_total_cents'] as number | null) ?? null,
    lastEventAt: (link['last_event_at'] as string | null) ?? null,
  }
}

export async function readSyncLog(organizationId: string, limit = 50): Promise<SyncRow[]> {
  const supabase = getSupabase()
  if (!supabase) return []
  const { data } = await supabase
    .from('roofr_sync_log')
    .select('id, direction, what, status, at, lead_id, error, attempts')
    .eq('organization_id', organizationId)
    .order('at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown[]).flatMap((raw) => {
    const r = row(raw)
    if (r === null) return []
    return [
      {
        id: r['id'] as string,
        direction: r['direction'] as 'inbound' | 'outbound',
        what: r['what'] as string,
        status: r['status'] as string,
        at: r['at'] as string,
        leadId: (r['lead_id'] as string | null) ?? null,
        error: (r['error'] as string | null) ?? null,
        attempts: (r['attempts'] as number | null) ?? null,
      },
    ]
  })
}

export type PushOutcome =
  | { readonly ok: true; readonly state: string }
  | { readonly ok: false; readonly error: string }

/**
 * Ask the server to create this lead in Roofr.
 *
 * The success case says "sent, waiting for Roofr to confirm" rather than
 * "created", because that is the true statement: Zapier accepted a POST. The
 * job exists when Roofr says it does, which arrives back through the inbound
 * webhook and is what turns the panel green.
 */
export async function pushLeadToRoofr(
  organizationId: string,
  leadClientId: string,
): Promise<PushOutcome> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'No connection to the server.' }
  const leadId = await remoteLeadIdForClientId(organizationId, leadClientId)
  if (!leadId) return { ok: false, error: 'This lead has not reached the server yet.' }

  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (token === undefined) return { ok: false, error: 'Sign in first.' }

  const { data, error } = await supabase.functions.invoke('roofr-push', {
    body: { lead_id: leadId },
  })

  if (error) {
    // The Edge Function puts the real reason in the body, which supabase-js
    // hides behind a generic message. Surfacing the generic one would tell a
    // manager "Edge Function returned a non-2xx status code" and nothing about
    // which rule refused their lead.
    const context = (error as { context?: Response }).context
    if (context !== undefined && typeof context.json === 'function') {
      try {
        const detail = (await context.json()) as { error?: string }
        if (typeof detail.error === 'string') return { ok: false, error: detail.error }
      } catch {
        /* fall through to the generic message */
      }
    }
    return { ok: false, error: error.message }
  }

  const state = (data as { state?: string } | null)?.state ?? 'sent'
  return { ok: true, state }
}
