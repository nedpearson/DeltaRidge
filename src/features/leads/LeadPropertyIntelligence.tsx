import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionTitle } from '@/components/ui'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import type { ManagedLead } from '@/features/leads/pipeline'
import { buildPropertyProfile } from '@/features/leads/property-profile'
import { distanceMiles } from '@/features/leads/scoring'

const STORM_RADIUS_MILES = 5

function ageLabel(years: number | null): string {
  return years === null ? 'Not established' : `About ${years} years`
}

function money(value: number | null): string {
  return value === null ? 'Not established' : `$${value.toLocaleString()}`
}

/**
 * The first P1 slice: property intelligence appears inside Lead 360 rather than
 * forcing a rep to leave the customer record to understand the house.
 *
 * The full property page remains available as a drill-down while P1 is being
 * folded together. Nothing here invents data: it is built from the same cached
 * lead run + provenance model the property page already uses.
 */
export default function LeadPropertyIntelligence({ lead }: { lead: ManagedLead }) {
  const [run, setRun] = useState<LeadRun | null>(null)

  useEffect(() => {
    void readCachedRun().then(setRun)
  }, [])

  const scored = useMemo(
    () => run?.leads.find((candidate) => candidate.addressKey === lead.addressKey) ?? null,
    [lead.addressKey, run],
  )

  const profile = useMemo(() => {
    if (!run || !scored) return null
    const storms = run.stormEvents.filter(
      (storm) =>
        distanceMiles(
          scored.latitude,
          scored.longitude,
          storm.latitude,
          storm.longitude,
        ) <= STORM_RADIUS_MILES,
    )

    return buildPropertyProfile({
      address: scored.address,
      addressKey: scored.addressKey,
      ...(scored.parcel ? { parcel: scored.parcel } : {}),
      permits: [scored.roofPermit],
      storms,
      now: new Date(),
    })
  }, [run, scored])

  if (!profile) {
    return (
      <>
        <SectionTitle>PROPERTY INTELLIGENCE</SectionTitle>
        <Card className="!py-3">
          <p className="text-[12px] leading-relaxed text-white/40">
            This lead is not in the current property-intelligence cache. Rebuild the lead list to
            refresh parcel, permit and storm evidence.
          </p>
        </Card>
      </>
    )
  }

  const owner = profile.owner.name.value
  const occupancy = profile.owner.occupancy.value
  const latestStorm = profile.storms[0] ?? null

  return (
    <>
      <SectionTitle>PROPERTY INTELLIGENCE</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-white/30">Recorded owner</p>
            <p className="mt-0.5 break-words text-[13px] text-white/85">
              {owner ?? 'Not established'}
            </p>
            <p className="mt-0.5 text-[10px] text-white/25">{profile.owner.name.source.label}</p>
          </div>

          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-white/30">Occupancy</p>
            <p className="mt-0.5 text-[13px] text-white/85">
              {occupancy === 'owner_occupied'
                ? 'Owner occupied'
                : occupancy === 'likely_absentee'
                  ? 'Likely absentee'
                  : 'Not established'}
            </p>
            <p className="mt-0.5 text-[10px] text-white/25">
              {profile.owner.occupancy.source.label}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-white/30">Roof age</p>
            <p className="mt-0.5 text-[13px] text-white/85">
              {ageLabel(profile.roof.ageYears.value)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/25">
              {profile.roof.ageYears.source.label}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-wider text-white/30">Assessed value</p>
            <p className="mt-0.5 text-[13px] text-white/85">
              {money(profile.assessedValue.value)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/25">
              {profile.assessedValue.source.label}
            </p>
          </div>
        </div>

        <div className="mt-3 border-t border-white/8 pt-3">
          <p className="text-[10.5px] uppercase tracking-wider text-white/30">Storm evidence</p>
          {latestStorm ? (
            <>
              <p className="mt-0.5 text-[13px] text-white/85">
                {latestStorm.hailSizeInches !== undefined
                  ? `${latestStorm.hailSizeInches}" officially reported nearby`
                  : 'Official storm report nearby'}
              </p>
              <p className="mt-0.5 text-[10px] text-white/25">
                NWS · {new Date(latestStorm.occurredAt).toLocaleDateString()} · report location, not
                a measurement at this roof
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-[12px] text-white/40">
              No qualifying official storm report within {STORM_RADIUS_MILES} miles in the current
              cached window.
            </p>
          )}
        </div>

        <Link
          to={`/property/${encodeURIComponent(lead.addressKey)}`}
          className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-white/6 px-3 text-[12.5px] font-medium text-white/75 ring-1 ring-white/10"
        >
          Open full property record
        </Link>
      </Card>
    </>
  )
}
