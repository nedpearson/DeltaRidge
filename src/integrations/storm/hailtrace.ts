import type {
  ProviderAvailability,
  StormEvent,
  StormGeometry,
  StormProvider,
  StormQuery,
} from './types'
import { getSupabase } from '@/lib/supabase'

export class HailTraceStormProvider implements StormProvider {
  readonly id = 'hailtrace' as const
  readonly displayName = 'HailTrace'
  readonly attribution = 'Weather data provided by HailTrace'
  readonly mayPersistGeometry = false // Per docs/INTEGRATION_RESEARCH.md, wait for explicit subscription clearance

  async availability(): Promise<ProviderAvailability> {
    const supabase = getSupabase()
    if (!supabase) return { available: false, reason: 'Supabase client not initialized.', actionable: false }
    
    // We assume the Edge Function handles auth checks. 
    // A more thorough check could ping a health endpoint on the edge function.
    return { available: true }
  }

  async searchEvents(query: StormQuery): Promise<StormEvent[]> {
    const supabase = getSupabase()
    if (!supabase) return []

    // Convert StormQuery to HailTrace's payload shape
    const [west, south, east, north] = query.bbox
    const centerLat = (south + north) / 2
    const centerLng = (west + east) / 2
    
    // Simplistic radius for bounding box
    const searchRadiusMi = 10 

    const payload: Record<string, unknown> = {
      latitude: centerLat,
      longitude: centerLng,
      search_radius_mi: searchRadiusMi,
      page_size: 100,
      page: 1,
      start_date: query.from.split('T')[0],
      end_date: query.to.split('T')[0],
      weather_types: query.eventTypes?.map(t => {
        if (t === 'hail') return 'ALGORITHM_HAIL_SIZE'
        if (t === 'wind') return 'WIND_SPEED'
        if (t === 'tornado') return 'TORNADO'
        return 'ALGORITHM_HAIL_SIZE'
      }) || ['ALGORITHM_HAIL_SIZE', 'WIND_SPEED', 'TORNADO'],
      include_shapes: false
    }

    if (query.minHailSizeInches) {
      payload.min_hail_size = query.minHailSizeInches
    }

    const { data, error } = await supabase.functions.invoke('hailtrace', {
      body: { action: 'searchEvents', payload }
    })

    if (error || !data || !data.results) {
      console.error('HailTrace search failed', error || data)
      return []
    }

    const events: StormEvent[] = []
    
    for (const result of data.results) {
      for (const shape of result.shapes || []) {
        const meta = shape.meta || {}
        let eventType: StormEvent['eventType'] = 'hail'
        if (shape.weather_type === 'WIND_SPEED') eventType = 'wind'
        if (shape.weather_type === 'TORNADO') eventType = 'tornado'

        events.push({
          externalId: `${result.date}-${shape.weather_type}`,
          provider: 'hailtrace',
          eventType,
          occurredAt: `${result.date}T00:00:00Z`,
          hailSizeInches: meta.hail_size_inches || result.max_algorithm_hail_size,
          windSpeedMph: meta.wind_speed_mph || result.max_meteorologist_wind_speed_mph,
          latitude: centerLat,
          longitude: centerLng,
          observation: 'radar_estimate',
          radarConfidence: 'radar_only'
        })
      }
    }

    return events
  }

  async eventGeometry(_externalId: string): Promise<StormGeometry | null> {
    return null
  }
}
