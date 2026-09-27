import { useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { RoutePoint } from '@/features/routes/route-store'
import { segmentsOf } from '@/features/routes/tracking'

export interface RouteMarker {
  id: string
  latitude: number
  longitude: number
  colour: string
  shape?: 'dot' | 'square'
}

interface Props {
  points: readonly RoutePoint[]
  markers?: readonly RouteMarker[]
  className?: string
  pulseLast?: boolean
  style?: 'streets' | 'satellite'
  height?: number
  through?: string
  onStyleChange?: (style: 'streets' | 'satellite') => void
}

function FitBounds({ points, markers = [] }: { points: readonly RoutePoint[], markers?: readonly RouteMarker[] }) {
  const map = useMap()
  
  useEffect(() => {
    // Only use valid points
    const validPoints = points.filter(p => p.latitude !== undefined && p.longitude !== undefined).map(p => ({ lat: p.latitude || 0, lng: p.longitude || 0 }))
    const validMarkers = markers.filter(m => m.latitude !== undefined && m.longitude !== undefined).map(m => ({ lat: m.latitude, lng: m.longitude }))
    
    const lats = [...validPoints.map(p => p.lat), ...validMarkers.map(m => m.lat)]
    const lngs = [...validPoints.map(p => p.lng), ...validMarkers.map(m => m.lng)]
    
    if (lats.length === 0) return
    
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    
    // Check if it's essentially a single point
    if (maxLat - minLat < 0.001 && maxLng - minLng < 0.001) {
      map.setView([lats[0] || 0, lngs[0] || 0], 16)
      return
    }
    
    const latPad = (maxLat - minLat) * 0.1 || 0.01
    const lngPad = (maxLng - minLng) * 0.1 || 0.01
    
    map.fitBounds([
      [minLat - latPad, minLng - lngPad],
      [maxLat + latPad, maxLng + lngPad]
    ])
  }, [points, markers, map])

  return null
}

export default function RouteMap({ points, markers = [], className = 'h-full w-full', pulseLast = false, style = 'streets', height, through }: Props) {
  const displayPoints = through ? points.filter(p => p.recordedAt <= through) : points
  const segments = segmentsOf(displayPoints)
  
  const validPoints = displayPoints.filter(p => p.latitude !== undefined && p.longitude !== undefined).map(p => ({ lat: p.latitude || 0, lng: p.longitude || 0 }))
  const defaultCenter: [number, number] = validPoints.length > 0 ? [validPoints[0]?.lat || 0, validPoints[0]?.lng || 0] : [39.8283, -98.5795]
  
  const tileUrl = style === 'satellite' 
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'

  const containerClasses = "relative bg-bg-elevated overflow-hidden " + className;

  return (
    <div className={containerClasses} style={height ? { height } : undefined}>
      <MapContainer 
        center={defaultCenter} 
        zoom={14} 
        scrollWheelZoom={false} 
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer url={tileUrl} />
        
        {(displayPoints.length > 0 || markers.length > 0) && <FitBounds points={displayPoints} markers={markers} />}

        {segments.map((seg, i) => {
          if (seg.from.latitude === undefined || seg.from.longitude === undefined || seg.to.latitude === undefined || seg.to.longitude === undefined) return null;
          
          const latlngs: [number, number][] = [
            [seg.from.latitude, seg.from.longitude],
            [seg.to.latitude, seg.to.longitude]
          ]
          return (
            <Polyline
              key={i}
              positions={latlngs}
              color="#20D4F5"
              weight={seg.gap ? 2 : 4}
              dashArray={seg.gap ? "5, 10" : undefined}
              opacity={seg.gap ? 0.5 : 1}
            />
          )
        })}

        {markers.map(m => (
          <CircleMarker
            key={m.id}
            center={[m.latitude, m.longitude]}
            radius={m.shape === 'square' ? 6 : 4}
            pathOptions={{
              fillColor: m.colour,
              fillOpacity: 1,
              color: '#070F1D',
              weight: 1
            }}
          />
        ))}

        {pulseLast && validPoints.length > 0 && (
          <CircleMarker
            center={[validPoints[validPoints.length - 1]?.lat || 0, validPoints[validPoints.length - 1]?.lng || 0]}
            radius={8}
            className="animate-pulse"
            pathOptions={{
              fillColor: '#20D4F5',
              fillOpacity: 0.5,
              color: 'transparent'
            }}
          />
        )}
      </MapContainer>
    </div>
  )
}



