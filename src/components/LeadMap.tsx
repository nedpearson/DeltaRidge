import { Suspense, lazy } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'

const LeadMapLive = lazy(() => import('@/components/LeadMapLive'))

interface Props {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  onOpenLead: (leadId: string) => void
}

function Loading() {
  return (
    <>
      <SectionTitle>MAP</SectionTitle>
      <Card className="!p-0 overflow-hidden">
        <div className="flex h-96 w-full items-center justify-center bg-bg-elevated">
          <p className="text-[12.5px] text-brand-950/50">Loading the map.</p>
        </div>
      </Card>
    </>
  )
}

export default function LeadMap(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <LeadMapLive {...props} />
    </Suspense>
  )
}
