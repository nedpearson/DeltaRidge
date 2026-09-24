import { getSupabase } from '@/lib/supabase'
import { readCachedRun } from '@/features/leads/engine'
import { buildPropertyProfile } from '@/features/leads/property-profile'
import { distanceMiles } from '@/features/leads/scoring'
import type { ManagedLead } from '@/features/leads/pipeline'
import { readLeadContactIdentity } from '@/features/contacts/identity-store'
import { dataHealthIssues, type DataHealthIssue } from './data-health'

const STORM_RADIUS_MILES = 5

export async function readLeadDataHealth(input: {
  lead: ManagedLead
  organizationId: string | null
  roofrJobId: string | null
  roofrLastEventAt: string | null
  pendingSyncItems: number
  failedSyncItems: number
}): Promise<DataHealthIssue[]> {
  const [run, contact] = await Promise.all([
    readCachedRun(),
    readLeadContactIdentity(input.organizationId, input.lead.id),
  ])

  const scored =
    run?.leads.find((candidate) => candidate.addressKey === input.lead.addressKey) ?? null

  const nearbyStorms =
    run && scored
      ? run.stormEvents.filter(
          (storm) =>
            distanceMiles(
              scored.latitude,
              scored.longitude,
              storm.latitude,
              storm.longitude,
            ) <= STORM_RADIUS_MILES,
        )
      : []

  const profile = scored
    ? buildPropertyProfile({
        address: scored.address,
        addressKey: scored.addressKey,
        ...(scored.parcel ? { parcel: scored.parcel } : {}),
        permits: [scored.roofPermit],
        storms: nearbyStorms,
        now: new Date(),
      })
    : null

  let homeownerRoofAge: number | null = null

  const supabase = getSupabase()
  if (supabase && input.organizationId && navigator.onLine) {
    const { data: remoteLead } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('client_id', input.lead.id)
      .maybeSingle()

    const remoteLeadId = (remoteLead?.id as string | undefined) ?? null
    if (remoteLeadId) {
      const { data: inspections } = await supabase
        .from('inspections')
        .select('homeowner_stated_roof_age_years, started_at')
        .eq('organization_id', input.organizationId)
        .eq('lead_id', remoteLeadId)
        .not('homeowner_stated_roof_age_years', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)

      const first = inspections?.[0]
      homeownerRoofAge =
        first?.homeowner_stated_roof_age_years === null ||
        first?.homeowner_stated_roof_age_years === undefined
          ? null
          : Number(first.homeowner_stated_roof_age_years)
    }
  }

  const phoneMethods = contact.methods.filter((method) => method.channel === 'phone')
  const confirmedPhones = phoneMethods
    .filter((method) => method.status === 'confirmed')
    .map((method) => method.value)
  const candidatePhones = phoneMethods
    .filter((method) => method.status === 'unconfirmed')
    .map((method) => method.value)

  return dataHealthIssues({
    localContactName: input.lead.contactName ?? contact.displayName,
    recordedOwnerName: profile?.owner.name.value ?? null,
    confirmedPhones,
    candidatePhones,
    wrongOrDisconnectedPhones: phoneMethods.filter(
      (method) => method.status === 'wrong_number' || method.status === 'disconnected',
    ).length,
    doNotContactPhones: phoneMethods.filter((method) => method.status === 'do_not_contact').length,
    localOptedOut: input.lead.optedOutAt !== undefined,
    permitRoofAgeYears: profile?.roof.ageYears.value ?? null,
    homeownerStatedRoofAgeYears: homeownerRoofAge,
    stormEvidenceCount: nearbyStorms.length,
    // No current imagery provider is wired into Lead 360 yet. Null is deliberate:
    // the panel should say the condition is not established rather than infer
    // freshness from a basemap tile or a provider connection.
    imageryCapturedAt: null,
    roofrJobId: input.roofrJobId,
    roofrLastEventAt: input.roofrLastEventAt,
    pendingSyncItems: input.pendingSyncItems,
    failedSyncItems: input.failedSyncItems,
    now: new Date().toISOString(),
  })
}
