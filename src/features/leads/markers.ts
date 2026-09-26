import type { LeadStatus, ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import type { StormEvent } from '@/integrations/storm'

/**
 * What goes on the map, and what colour it is.
 *
 * Shared by the live map and the static fallback so the two never drift into
 * saying different things about the same door — which is the failure mode of
 * having two maps at all.
 */

export type MarkerStatus = LeadStatus | 'door'

export interface Marker {
  id: string
  latitude: number
  longitude: number
  status: MarkerStatus
  label: string
  leadId?: string
}

/**
 * Chosen to sit on a LIGHT street map and on satellite imagery. Every one of
 * them is drawn with a white halo, which is what keeps a dot legible on a pale
 * road, on grass and on a dark roof without changing its colour.
 */
export const COLOUR: Record<MarkerStatus, string> = {
  door: '#8FA3B8',
  new: '#8FA3B8',
  attempted: '#D58B32',
  follow_up: '#D58B32',
  need_visit: '#4776E6',
  appointment: '#D9A441',
  inspected: '#D9A441',
  not_interested: '#E75A64',
  // Grey, not red. A door that was never a prospect is not a rejection, and a
  // map that paints the two the same colour tells a manager the neighbourhood
  // is hostile when it is simply already re-roofed.
  disqualified: '#64768B',
  do_not_knock: '#E75A64',
}

/** The legend sits on the app's dark card, where slate-600 is too dim. */
export const LEGEND_COLOUR: Record<MarkerStatus, string> = {
  ...COLOUR,
  door: '#8FA3B8',
}

export const LEGEND: { status: MarkerStatus; label: string }[] = [
  { status: 'door', label: 'Not knocked' },
  { status: 'follow_up', label: 'Owed a visit' },
  { status: 'need_visit', label: 'Wants a look' },
  { status: 'appointment', label: 'Booked' },
  { status: 'do_not_knock', label: 'Off the list' },
]

/**
 * Leads first, then the doors they did not come from.
 *
 * A door that has become somebody must not be drawn twice, and when the two
 * disagree the pipeline colour is the one that matters.
 */
export function markersFor(
  doors: readonly ScoredLead[],
  leads: readonly ManagedLead[],
): Marker[] {
  const promoted = new Set(leads.map((l) => l.addressKey))

  const fromLeads = leads.map(
    (l): Marker => ({
      id: l.id,
      latitude: l.latitude,
      longitude: l.longitude,
      status: l.status,
      label: l.contactName ? `${l.contactName} — ${l.address}` : l.address,
      leadId: l.id,
    }),
  )

  const fromDoors = doors
    .filter((d) => !promoted.has(d.addressKey))
    .map(
      (d): Marker => ({
        id: d.addressKey,
        latitude: d.latitude,
        longitude: d.longitude,
        status: 'door',
        label: d.address,
      }),
    )

  return [...fromLeads, ...fromDoors].filter(
    (m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude),
  )
}

interface FeatureCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: Record<string, string | number>
  }[]
}

export function markersToGeoJson(markers: readonly Marker[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.longitude, m.latitude] },
      properties: {
        id: m.id,
        status: m.status,
        label: m.label,
        // GeoJSON properties are flat, and an absent key reads back as
        // undefined rather than an empty string, which the click handler
        // would then have to guess about.
        leadId: m.leadId ?? '',
      },
    })),
  }
}

export function stormsToGeoJson(storms: readonly StormEvent[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: storms
      .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
        properties: {
          id: s.externalId,
          hail: s.hailSizeInches ?? 1,
        },
      })),
  }
}

/**
 * A Mapbox `match` expression over the status property.
 *
 * Built from the same record the fallback map reads, so adding a status in one
 * place cannot leave the other drawing it in the default colour.
 */
export function colourExpression(): unknown[] {
  const pairs: string[] = []
  for (const [status, colour] of Object.entries(COLOUR)) {
    if (status === 'door') continue
    pairs.push(status, colour)
  }
  return ['match', ['get', 'status'], ...pairs, COLOUR.door]
}
