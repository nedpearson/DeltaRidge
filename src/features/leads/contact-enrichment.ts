import { getSupabase } from '@/lib/supabase'
import { findByAddress, promote, saveLead } from './lead-store'
import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'

export interface EnrichedContact {
  readonly success: boolean
  readonly message?: string
  readonly residentName?: string | null | undefined
  readonly phone?: string | null | undefined
  readonly email?: string | null | undefined
  readonly phoneType?: 'Wireless' | 'Landline' | 'Unknown' | undefined
  readonly carrier?: string | null | undefined
  readonly secondaryPhones?: Array<{ phone: string; type: string; carrier?: string }> | undefined
  readonly source?: 'public_record' | 'third_party_lookup' | undefined
  readonly searchUrl?: string | undefined
}

export function buildFreeSearchUrl(street: string, city = 'Baton Rouge', state = 'LA', zip = '70810'): string {
  const streetSlug = street.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
  return `https://www.fastpeoplesearch.com/address/${streetSlug}_${citySlug}-${state.toLowerCase()}-${zip}`
}

export function buildTruePeopleSearchUrl(street: string, city = 'Baton Rouge', state = 'LA', zip = '70810'): string {
  return `https://www.truepeoplesearch.com/resultaddress?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state} ${zip}`)}`
}

/**
 * Fetch contact phone for a lead via Edge Function or local cache.
 */
export async function lookupResidentContact(params: {
  street: string
  city?: string | undefined
  state?: string | undefined
  zip?: string | undefined
  ownerName?: string | null | undefined
}): Promise<EnrichedContact> {
  let street = params.street.trim()
  const city = params.city || 'Baton Rouge'
  const state = params.state || 'LA'
  const zip = params.zip || '70810'

  // If the street parameter contains the full address, strip the city/state/zip
  const cityStateZip = `${city} ${state} ${zip}`.toLowerCase()
  if (street.toLowerCase().endsWith(cityStateZip)) {
    street = street.slice(0, -(cityStateZip.length)).trim()
  } else if (street.toLowerCase().endsWith(`${state} ${zip}`.toLowerCase())) {
    street = street.slice(0, -(`${state} ${zip}`.length)).trim()
  }

  try {
    const supabase = getSupabase()
    if (supabase) {
      const { data, error } = await supabase.functions.invoke('lookup-contact', {
        body: {
          street,
          city,
          state,
          zip,
          ownerName: params.ownerName || undefined,
        },
      })

      if (!error && data?.success && (data?.phone || data?.email)) {
        return {
          success: true,
          residentName: data.residentName ?? null,
          phone: data.phone,
          email: data.email,
          phoneType: data.phoneType ?? 'Wireless',
          carrier: data.carrier ?? null,
          secondaryPhones: data.secondaryPhones ?? [],
          source: data.source ?? 'third_party_lookup',
          searchUrl: buildFreeSearchUrl(street, city, state, zip),
        }
      }
    }
  } catch {
    // Network or edge function failure fallback
  }

  return {
    success: false,
    searchUrl: buildFreeSearchUrl(street, city, state, zip),
  }
}

/**
 * Save an enriched or rep-entered phone number onto a managed lead.
 */
export async function saveResidentContact(
  lead: ScoredLead | ManagedLead,
  phone?: string | null | undefined,
  email?: string | null | undefined,
  name?: string | null | undefined
): Promise<ManagedLead> {
  const addressKey = lead.addressKey
  let record = await findByAddress(addressKey)
  const now = new Date().toISOString()

  if (!record) {
    if ('reasons' in lead) {
      record = promote(lead as ScoredLead, now)
    } else {
      record = lead as ManagedLead
    }
  }

  const updated: ManagedLead = {
    ...record,
    ...(phone?.trim() ? { contactPhone: phone.trim() } : {}),
    ...(email?.trim() ? { contactEmail: email.trim() } : {}),
    ...(name?.trim() ? { contactName: name.trim() } : {}),
    contactSource: 'third_party_lookup',
    updatedAt: now,
  }

  await saveLead(updated)
  return updated
}
