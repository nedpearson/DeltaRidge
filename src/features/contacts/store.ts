import { getSupabase } from '@/lib/supabase'
import { DEFAULT_ENRICHMENT, type EnrichmentConfig, type EnrichmentEntitlement } from './enrichment'

/**
 * Reading and writing what this company is entitled to use.
 *
 * Holds no credential and has no field that could hold one. The provider key is
 * an Edge Function secret; a box on an admin screen would be an invitation to
 * paste it somewhere that ships to every phone in the field.
 */

export interface ProviderSettings extends EnrichmentConfig {
  readonly confirmedBy: string | null
  readonly confirmedAt: string | null
  readonly basis: string | null
}

export const UNSET: ProviderSettings = {
  ...DEFAULT_ENRICHMENT,
  confirmedBy: null,
  confirmedAt: null,
  basis: null,
}

export async function readProviderSettings(organizationId: string): Promise<ProviderSettings> {
  const supabase = getSupabase()
  if (!supabase) return UNSET
  const { data } = await supabase
    .from('contact_provider_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()

  const row = data as Record<string, unknown> | null
  // No row means nothing has been configured, which is the same thing as not
  // being entitled to anything. Absence is a refusal, not a gap to fill in.
  if (row === null) return UNSET

  return {
    entitlement: (row['entitlement'] as EnrichmentEntitlement) ?? 'none',
    credentialPresent: row['credential_present'] === true,
    commercialUseConfirmed: row['commercial_use_confirmed'] === true,
    secondaryProvidersEnabled: row['secondary_providers_enabled'] === true,
    confirmedBy: (row['commercial_use_confirmed_by'] as string | null) ?? null,
    confirmedAt: (row['commercial_use_confirmed_at'] as string | null) ?? null,
    basis: (row['commercial_use_basis'] as string | null) ?? null,
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string }

export async function saveProviderSettings(
  organizationId: string,
  userId: string,
  patch: {
    entitlement?: EnrichmentEntitlement
    credentialPresent?: boolean
    secondaryProvidersEnabled?: boolean
    /** Confirming requires a basis; the database rejects an unattributed one. */
    confirmCommercialUse?: { basis: string } | false
  },
): Promise<SaveResult> {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, error: 'No connection to the server.' }

  const row: Record<string, unknown> = { organization_id: organizationId, updated_by: userId }
  if (patch.entitlement !== undefined) row['entitlement'] = patch.entitlement
  if (patch.credentialPresent !== undefined) row['credential_present'] = patch.credentialPresent
  if (patch.secondaryProvidersEnabled !== undefined) {
    row['secondary_providers_enabled'] = patch.secondaryProvidersEnabled
  }
  if (patch.confirmCommercialUse !== undefined) {
    if (patch.confirmCommercialUse === false) {
      row['commercial_use_confirmed'] = false
      row['commercial_use_confirmed_by'] = null
      row['commercial_use_confirmed_at'] = null
      row['commercial_use_basis'] = null
    } else {
      if (patch.confirmCommercialUse.basis.trim() === '') {
        return { ok: false, error: 'Name the agreement that permits this.' }
      }
      row['commercial_use_confirmed'] = true
      row['commercial_use_confirmed_by'] = userId
      row['commercial_use_confirmed_at'] = new Date().toISOString()
      row['commercial_use_basis'] = patch.confirmCommercialUse.basis.trim()
    }
  }

  const { error } = await supabase
    .from('contact_provider_settings')
    .upsert(row, { onConflict: 'organization_id' })
  // Surfaced, not swallowed: a 403 here means the RLS policy did its job and
  // the person is not an admin, and a silently dead button reads as a bug.
  return error ? { ok: false, error: error.message } : { ok: true }
}
