import { getSupabase } from '@/lib/supabase'
import type {
  ProviderAvailability,
  StormEvent,
  StormGeometry,
  StormProvider,
  StormQuery,
} from './types'

const PRODUCT = 'MESH_Max_30min'
const FRESH_MINUTES = 20

interface MeshRow {
  product: string
  valid_at: string
  grid_key: string
  mesh_inches: number | string
  latitude: number
  longitude: number
}

/**
 * NOAA MRMS MESH stored by the server-side GRIB2 worker.
 *
 * MESH is radar-derived Maximum Estimated Size of Hail. It is not a ground
 * report and is never described as one. The worker converts the GRIB base unit
 * (mm) to inches before persistence.
 */
export class MrmsStormProvider implements StormProvider {
  readonly id = 'mrms' as const
  readonly displayName = 'NOAA MRMS MESH'
  readonly attribution = 'Source: NOAA/NSSL Multi-Radar Multi-Sensor (MRMS) MESH'
  readonly mayPersistGeometry = true

  async availability(): Promise<ProviderAvailability> {
    const supabase = getSupabase()
    if (!supabase) {
      return {
        available: false,
        reason: 'The server connection is unavailable, so MRMS grid data cannot be read.',
        actionable: false,
      }
    }

    const { data, error } = await supabase
      .from('mrms_health')
      .select('latest_success_at, latest_success_valid_at, coverage_started_at')
      .eq('product', PRODUCT)
      .maybeSingle()

    if (error) {
      return {
        available: false,
        reason: 'The MRMS ingest status could not be read from the server.',
        actionable: true,
      }
    }
    if (!data?.latest_success_at) {
      return {
        available: false,
        reason: 'The MRMS worker has not completed a successful ingest yet.',
        actionable: true,
      }
    }

    const ageMinutes =
      (Date.now() - new Date(data.latest_success_at as string).getTime()) / 60_000
    if (!Number.isFinite(ageMinutes) || ageMinutes > FRESH_MINUTES) {
      const ageLabel = Number.isFinite(ageMinutes) ? String(Math.round(ageMinutes)) : 'unknown'
      return {
        available: false,
        reason: 'The MRMS worker is stale; its last successful ingest was ' + ageLabel + ' minutes ago.',
        actionable: true,
      }
    }

    return { available: true }
  }

  async searchEvents(query: StormQuery): Promise<StormEvent[]> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('MRMS server connection is unavailable.')

    const [west, south, east, north] = query.bbox
    const { data, error } = await supabase.rpc('search_mrms_mesh', {
      p_west: west,
      p_south: south,
      p_east: east,
      p_north: north,
      p_from: query.from,
      p_to: query.to,
      p_min_inches: query.minHailSizeInches ?? 0,
      p_limit: 25000,
    })

    if (error) throw new Error('MRMS search failed: ' + error.message)

    return ((data ?? []) as unknown as MeshRow[]).map((row) => ({
      externalId: 'mrms:' + row.valid_at + ':' + row.grid_key,
      provider: 'mrms' as const,
      eventType: 'hail' as const,
      occurredAt: row.valid_at,
      hailSizeInches: Number(row.mesh_inches),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      observation: 'radar_estimate' as const,
      magnitudeNote:
        'NOAA MRMS MESH Max 30-minute radar estimate. This is not an observation of hail on the ground.',
    }))
  }

  async eventGeometry(_externalId: string): Promise<StormGeometry | null> {
    return null
  }
}
