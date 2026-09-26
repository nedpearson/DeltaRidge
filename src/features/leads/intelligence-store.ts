import { readCachedRun } from './engine'
import { evaluateLeadIntelligence, LEAD_INTELLIGENCE_VERSION } from './intelligence'
import type { ManagedLead } from './pipeline'
import { getSupabase } from '@/lib/supabase'

function contactSource(
  lead: ManagedLead,
): 'homeowner' | 'public_record' | 'third_party_lookup' | 'unknown' | 'none' {
  if (!lead.contactPhone && !lead.contactEmail) return 'none'
  if (
    lead.contactSource === 'homeowner_at_door' ||
    lead.contactSource === 'homeowner_by_phone' ||
    lead.contactSource === 'homeowner_in_writing'
  ) {
    return 'homeowner'
  }
  if (lead.contactSource === 'public_record') return 'public_record'
  if (lead.contactSource === 'third_party_lookup') return 'third_party_lookup'
  return 'unknown'
}

/**
 * Persists the intelligence state that existed when a synced lead was written.
 *
 * This is deliberately a snapshot instead of mutable score columns. Assignment
 * fairness and outcome analysis need the score/reasons the rep actually
 * received, not a score recomputed months later with newer data.
 */
export async function snapshotLeadIntelligence(input: {
  organizationId: string
  remoteLeadId: string
  userId: string
  lead: ManagedLead
  propertyId: string
}): Promise<{ written: boolean; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { written: false, error: 'Server is not configured.' }

  const run = await readCachedRun()
  const scored =
    run?.leads.find((candidate) => candidate.addressKey === input.lead.addressKey) ?? null
  if (!scored) {
    return {
      written: false,
      error: 'The property intelligence run that produced this lead is no longer on this device.',
    }
  }

  // Only canonical provider-linked imagery earns imagery credit. A Mapbox
  // basemap tile is navigation context, not current-condition roof evidence.
  const { data: imageryRows } = await supabase
    .from('property_imagery')
    .select('imagery_capture_id, imagery_captures(captured_from,captured_until)')
    .eq('organization_id', input.organizationId)
    .eq('property_id', input.propertyId)
    .order('created_at', { ascending: false })
    .limit(1)

  const imageryRecord = (imageryRows?.[0] ?? null) as
    | {
        imagery_captures?:
          | { captured_from?: string | null; captured_until?: string | null }
          | { captured_from?: string | null; captured_until?: string | null }[]
          | null
      }
    | null
  const capture = Array.isArray(imageryRecord?.imagery_captures)
    ? imageryRecord?.imagery_captures[0]
    : imageryRecord?.imagery_captures
  const captureDate = capture?.captured_until ?? capture?.captured_from ?? null
  const imageryAgeDays =
    captureDate === null
      ? null
      : Math.max(0, Math.floor((Date.now() - Date.parse(captureDate)) / 86_400_000))

  const source = contactSource(input.lead)
  const result = evaluateLeadIntelligence({
    scored,
    managed: input.lead,
    hasCurrentImagery: captureDate !== null,
    ...(imageryAgeDays !== null ? { imageryAgeDays } : {}),
    // A dedicated provider-neutral measurement record is not yet linked here.
    // Do not infer it merely because an estimate exists.
    hasRoofMeasurement: false,
    ownerIdentified: Boolean(scored.parcel?.ownerName),
    ownerOccupied:
      scored.parcel?.occupancy === 'owner_occupied'
        ? true
        : scored.parcel?.occupancy === 'likely_absentee'
          ? false
          : null,
    phonePresent: Boolean(input.lead.contactPhone),
    emailPresent: Boolean(input.lead.contactEmail),
    contactConfirmed: source === 'homeowner',
    contactSource: source,
    optedOut: input.lead.optedOutAt !== undefined || input.lead.status === 'do_not_knock',
    appointmentConfirmed: input.lead.status === 'appointment',
  })

  const { error } = await supabase.from('lead_intelligence_snapshots').insert({
    organization_id: input.organizationId,
    lead_id: input.remoteLeadId,
    property_score: result.propertyScore,
    intent_score: result.intentScore,
    contactability_score: result.contactabilityScore,
    overall_priority: result.overallPriority,
    certification: result.certification,
    property_reasons: result.propertyReasons,
    intent_reasons: result.intentReasons,
    contactability_reasons: result.contactabilityReasons,
    evidence: {
      address_key: input.lead.addressKey,
      source_run_at: run?.ranAt ?? null,
      source_engine_version: run?.engineVersion ?? null,
      imagery_capture_date: captureDate,
      contact_source: source,
    },
    missing_requirements: result.missingRequirements,
    scoring_version: LEAD_INTELLIGENCE_VERSION,
    computed_by: input.userId,
  })

  return error ? { written: false, error: error.message } : { written: true, error: null }
}
