import { lazy, Suspense, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import LeadMapStatic from '@/components/LeadMapStatic'
import { hasBasemap } from '@/features/leads/basemap'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'

/**
 * Which map to show.
 *
 * The real one — pans, pinches, labels every street — whenever it can run,
 * and the static image when it cannot: no token, no WebGL, or a style that
 * never loaded because there is no signal. A rep in a dead spot gets dots and
 * a cached image rather than a grey rectangle.
 *
 * `LeadMapLive` is loaded lazily on purpose. Mapbox GL is a large library and
 * this keeps it out of the main bundle, so the inspection flow and the
 * estimator do not pay for a map they never show.
 */

const LeadMapLive = lazy(() => import('@/components/LeadMapLive'))

interface Props {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  searchCenter?: { latitude: number; longitude: number }
  searchRadiusMiles?: number
  onOpenLead: (leadId: string) => void
}

function Loading() {
  return (
    <>
      <SectionTitle>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div className="flex h-96 w-full items-center justify-center bg-bg-elevated">
          <p className="text-[12.5px] text-brand-950/50">Loading the map…</p>
        </div>
      </Card>
    </>
  )
}

export default function LeadMap(props: Props) {
  const [fellBack, setFellBack] = useState(false)

  if (!hasBasemap() || fellBack) return <LeadMapStatic {...props} />

  return (
    <Suspense fallback={<Loading />}>
      <LeadMapLive {...props} onFailed={() => setFellBack(true)} />
    </Suspense>
  )
}
