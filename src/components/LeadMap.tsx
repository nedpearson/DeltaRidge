import EagleViewLeadMap from '@/features/imagery/EagleViewLeadMap'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { SearchCenter } from '@/features/leads/search-area'
import type { StormEvent } from '@/integrations/storm'

interface Props {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  searchCenter?: SearchCenter
  searchRadiusMiles?: number
  onOpenLead: (leadId: string) => void
}

/**
 * Delta Ridge uses EagleView for in-app aerial mapping and roof imagery.
 *
 * There is deliberately no Mapbox fallback here. If EagleView WMTS is not
 * entitled/configured, the screen keeps the property/storm overlays visible
 * and states that imagery is unavailable rather than silently switching to a
 * different mapping provider.
 */
export default function LeadMap(props: Props) {
  return <EagleViewLeadMap {...props} />
}
