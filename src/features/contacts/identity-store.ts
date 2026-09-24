import { getSupabase } from '@/lib/supabase'

export type ContactChannel = 'phone' | 'email'
export type ContactMethodStatus =
  | 'unconfirmed'
  | 'confirmed'
  | 'wrong_number'
  | 'disconnected'
  | 'do_not_contact'

export interface LeadContactMethod {
  id: string
  customerId: string
  channel: ContactChannel
  value: string
  label: 'primary' | 'secondary' | 'other'
  status: ContactMethodStatus
  kind: string
  source: string
  providerConfidence: 'high' | 'medium' | 'low' | null
  retrievedAt: string | null
  enteredAt: string
  statusSetAt: string | null
}

export interface LeadContactIdentity {
  customerId: string | null
  displayName: string | null
  methods: LeadContactMethod[]
  error: string | null
}

function displayNameOf(row: Record<string, unknown>): string | null {
  const company = (row['company_name'] as string | null) ?? null
  if (company) return company
  const first = (row['first_name'] as string | null) ?? null
  const last = (row['last_name'] as string | null) ?? null
  const name = [first, last].filter(Boolean).join(' ').trim()
  return name === '' ? null : name
}

export async function readLeadContactIdentity(
  orgId: string | null,
  leadClientId: string,
): Promise<LeadContactIdentity> {
  const supabase = getSupabase()
  if (!supabase || !orgId) {
    return { customerId: null, displayName: null, methods: [], error: null }
  }

  const { data, error } = await supabase
    .from('lead_contact_methods')
    .select('*')
    .eq('organization_id', orgId)
    .eq('lead_client_id', leadClientId)

  if (error) {
    return { customerId: null, displayName: null, methods: [], error: error.message }
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const first = rows[0]
  const customerId = first ? ((first['customer_id'] as string | null) ?? null) : null
  const displayName = first ? displayNameOf(first) : null

  const methods = rows
    .filter((row) => row['method_id'] !== null)
    .map((row): LeadContactMethod => ({
      id: row['method_id'] as string,
      customerId: row['customer_id'] as string,
      channel: row['channel'] as ContactChannel,
      value: row['value'] as string,
      label: row['label'] as LeadContactMethod['label'],
      status: row['status'] as ContactMethodStatus,
      kind: (row['kind'] as string | null) ?? 'unknown',
      source: row['source'] as string,
      providerConfidence:
        (row['provider_confidence'] as LeadContactMethod['providerConfidence']) ?? null,
      retrievedAt: (row['retrieved_at'] as string | null) ?? null,
      enteredAt: row['entered_at'] as string,
      statusSetAt: (row['status_set_at'] as string | null) ?? null,
    }))

  return { customerId, displayName, methods, error: null }
}

export async function setContactMethodStatus(
  orgId: string,
  methodId: string,
  status: ContactMethodStatus,
  userId: string,
): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'The app is not configured for a server.' }

  // A do-not-contact row is deliberately not reversible through this ordinary
  // workflow. An explicit manager/admin process can be added later with a
  // reason; the field UI must never casually re-enable a suppressed line.
  const { data: existing, error: readError } = await supabase
    .from('customer_contact_methods')
    .select('status')
    .eq('organization_id', orgId)
    .eq('id', methodId)
    .maybeSingle()

  if (readError) return { error: readError.message }
  if ((existing?.status as string | undefined) === 'do_not_contact' && status !== 'do_not_contact') {
    return { error: 'This contact method is suppressed and cannot be re-enabled from the field.' }
  }

  const { error } = await supabase
    .from('customer_contact_methods')
    .update({
      status,
      status_set_by: userId,
      status_set_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('id', methodId)

  return { error: error?.message ?? null }
}
