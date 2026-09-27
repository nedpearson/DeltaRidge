import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { Button } from '@/components/ui'
import { readLeads } from '@/features/leads/lead-store'

// Fix Leaflet's default icon path issues in React
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
})

// Custom pins
const LeadPin = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234776E6"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>'),
  iconSize: [30, 30],
  iconAnchor: [15, 30]
})

const JobPin = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2334C990"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>'),
  iconSize: [30, 30],
  iconAnchor: [15, 30]
})



export default function MapPage() {
  const [leads, setLeads] = useState<Array<{id: string, address: string, status: string, score: number, lat: number, lng: number}>>([])
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'jobs'>('all')

  useEffect(() => {
    readLeads().then(data => {
      // Create mock coordinates slightly offset from a center point for demo
      // In production, properties must store valid coordinates.
      const baseLat = 30.2672
      const baseLng = -97.7431
      
      const mapped = data.map((lead) => ({
        ...lead,
        lat: baseLat + (Math.random() - 0.5) * 0.02,
        lng: baseLng + (Math.random() - 0.5) * 0.02
      }))
      setLeads(mapped)
    })
  }, [])

  const filteredLeads = leads.filter(l => {
    if (filter === 'all') return true
    if (filter === 'jobs') return l.status === 'won'
    return l.status !== 'won'
  })

  return (
    <div className="relative h-[calc(100vh-4rem)] flex flex-col bg-bg-page">
      <div className="absolute top-4 left-4 right-4 z-[400] flex gap-2">
        <Button variant={filter === 'all' ? 'primary' : 'secondary'} className="shadow-lg" onClick={() => setFilter('all')}>All Activity</Button>
        <Button variant={filter === 'opportunities' ? 'primary' : 'secondary'} className="shadow-lg" onClick={() => setFilter('opportunities')}>Opportunities</Button>
        <Button variant={filter === 'jobs' ? 'primary' : 'secondary'} className="shadow-lg bg-status-success/20 text-status-success hover:bg-status-success/30" onClick={() => setFilter('jobs')}>Completed Jobs</Button>
      </div>

      <MapContainer 
        center={[30.2672, -97.7431]} 
        zoom={14} 
        className="w-full flex-1 z-0"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap & EagleView'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles"
        />
        
        {filteredLeads.map(lead => (
          <Marker 
            key={lead.id} 
            position={[lead.lat, lead.lng]}
            icon={lead.status === 'won' ? JobPin : LeadPin}
          >
            <Popup className="custom-popup">
              <div className="p-2 min-w-[200px]">
                <span className={lead.status === 'won' ? 'bg-status-success/20 text-status-success text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm mb-2 inline-block' : 'bg-brand-primary/20 text-brand-primary text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm mb-2 inline-block'}>
                  {lead.status === 'won' ? 'Delta Ridge Roof' : 'Opportunity'}
                </span>
                <h3 className="font-bold text-[14px] mt-1">{lead.address}</h3>
                <p className="text-[12px] text-text-secondary mt-1">Score: {lead.score}</p>
                <div className="mt-3">
                  <Button variant="secondary" className="w-full text-[11px]">Open File</Button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      
      {/* Target/Crosshair styling in index.css */}
    </div>
  )
}







