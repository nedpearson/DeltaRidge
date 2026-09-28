import { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap, Polyline, Polygon } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Button, Card } from '@/components/ui'
import { STATUS_LABEL, type LeadStatus, type ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import type { StormEvent } from '@/integrations/storm'
import { LEGEND_COLOUR } from '@/features/leads/markers'

// A small component to auto-fit bounds when leads change
function FitBounds({ leads }: { leads: (ScoredLead | ManagedLead)[] }) {
  const map = useMap()
  
  useEffect(() => {
    if (!leads || leads.length === 0) return
    const lats = leads.map(l => l.latitude)
    const lngs = leads.map(l => l.longitude)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    
    // Add some padding
    const latPad = (maxLat - minLat) * 0.1 || 0.01
    const lngPad = (maxLng - minLng) * 0.1 || 0.01
    
    map.fitBounds([
      [minLat - latPad, minLng - lngPad],
      [maxLat + latPad, maxLng + lngPad]
    ])
  }, [leads, map])

  return null
}

export interface LeadMapLiveProps {
  doors: readonly ScoredLead[]
  leads: readonly ManagedLead[]
  storms: readonly StormEvent[]
  onOpenLead: (leadId: string) => void
  onFailed?: () => void
}

export default function LeadMapLive({ doors, leads, storms, onOpenLead }: LeadMapLiveProps) {
  const allPoints = [...doors, ...leads]
  const defaultCenter: [number, number] = [39.8283, -98.5795] // Default to US center if no leads
  const [activeLead, setActiveLead] = useState<(ScoredLead | ManagedLead) | null>(null)
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark')
  const [managerMode, setManagerMode] = useState(false)
  const [turfClaimed, setTurfClaimed] = useState(false)

  const handleSelect = useCallback((lead: ScoredLead | ManagedLead) => {
    setActiveLead(lead)
  }, [])

  // Get color based on status/score
  const getLeadColor = (lead: ScoredLead | ManagedLead) => {
    const status = (lead as ManagedLead).status
    if (status) return LEGEND_COLOUR[status] || LEGEND_COLOUR['new']
    // If no status, it's a ScoredLead (door)
    if (lead.score >= 80) return '#20D4F5' // Custom highlight color for high score
    return LEGEND_COLOUR['door']
  }

  return (
    <div className="relative w-full h-[600px] bg-bg-elevated rounded-xl overflow-hidden border border-border-subtle shadow-inner">
      <MapContainer 
        center={defaultCenter} 
        zoom={4} 
        scrollWheelZoom={true} 
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors - Street view only.'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {mapStyle === 'satellite' && (
           <div className="absolute inset-0 z-[400] flex items-center justify-center bg-bg-app/80 backdrop-blur-sm">
              <div className="bg-bg-elevated p-4 rounded-lg border border-status-warning/30 text-center shadow-xl">
                 <p className="text-[13px] font-bold text-status-warning mb-1">EagleView Imagery Unavailable</p>
                 <p className="text-[11px] text-text-secondary">Delta Ridge is strictly entitled for EagleView aerial imagery.</p>
                 <p className="text-[11px] text-text-secondary mt-1">Provider configuration required.</p>
              </div>
           </div>
        )}
        
        {allPoints.length > 0 && <FitBounds leads={allPoints} />}

        {managerMode && allPoints.length > 1 && (
          <Polyline 
            positions={allPoints.map(p => [p.latitude, p.longitude])} 
            pathOptions={{ color: '#E8BD63', weight: 3, dashArray: '5, 10', opacity: 0.8 }} 
          />
        )}

        {turfClaimed && allPoints.length > 0 && (
          <Polygon 
            positions={[
              [Math.max(...allPoints.map(p => p.latitude)) + 0.005, Math.min(...allPoints.map(p => p.longitude)) - 0.005],
              [Math.max(...allPoints.map(p => p.latitude)) + 0.005, Math.max(...allPoints.map(p => p.longitude)) + 0.005],
              [Math.min(...allPoints.map(p => p.latitude)) - 0.005, Math.max(...allPoints.map(p => p.longitude)) + 0.005],
              [Math.min(...allPoints.map(p => p.latitude)) - 0.005, Math.min(...allPoints.map(p => p.longitude)) - 0.005],
            ]}
            pathOptions={{ fillColor: '#E75A64', fillOpacity: 0.2, color: '#E75A64', weight: 2 }}
          />
        )}

        {allPoints.map(lead => (
          <CircleMarker
            key={'id' in lead ? lead.id : `${lead.latitude}-${lead.longitude}`}
            center={[lead.latitude, lead.longitude]}
            radius={8}
            pathOptions={{ 
              fillColor: getLeadColor(lead), 
              fillOpacity: 0.9, 
              color: '#070F1D', 
              weight: 2 
            }}
            eventHandlers={{
              click: () => handleSelect(lead)
            }}
          />
        ))}
      </MapContainer>

      {/* Map Tools */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
        <button 
          onClick={() => setMapStyle(s => s === 'dark' ? 'satellite' : 'dark')}
          className="bg-bg-card/90 backdrop-blur-sm p-2 shadow-lg rounded-lg border border-border-subtle flex items-center gap-2 hover:bg-bg-elevated transition-colors text-[11px] font-bold uppercase tracking-wider text-text-primary"
        >
          {mapStyle === 'dark' ? '🛰️ Satellite' : '🗺️ Map'}
        </button>
        <button 
          onClick={() => setTurfClaimed(t => !t)}
          className={`bg-bg-card/90 backdrop-blur-sm p-2 shadow-lg rounded-lg border border-border-subtle flex items-center gap-2 hover:bg-bg-elevated transition-colors text-[11px] font-bold uppercase tracking-wider ${turfClaimed ? 'text-status-critical' : 'text-text-primary'}`}
        >
          🚩 {turfClaimed ? 'Release Turf' : 'Claim Turf'}
        </button>
        <button 
          onClick={() => setManagerMode(m => !m)}
          className={`bg-bg-card/90 backdrop-blur-sm p-2 shadow-lg rounded-lg border border-border-subtle flex items-center gap-2 hover:bg-bg-elevated transition-colors text-[11px] font-bold uppercase tracking-wider ${managerMode ? 'text-brand-gold' : 'text-text-primary'}`}
        >
          👁️ {managerMode ? 'Hide Paths' : 'Manager View'}
        </button>
      </div>

      {/* Custom Overlay UI instead of Leaflet Popup for better styling */}
      {activeLead && (
        <div className="absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-80 z-[1000]">
          <Card className="bg-bg-card p-4 shadow-xl border-t-4 border-t-brand-500 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-bold text-[16px] text-text-primary flex items-center gap-2">
                  {activeLead.address}
                  <button 
                    onClick={() => navigator.clipboard.writeText(activeLead.address)}
                    className="text-text-muted hover:text-brand-400 transition-colors p-1"
                    title="Copy Address"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </h3>
                <div className="flex gap-2 mt-1">
                  <span className="text-[12px] font-bold text-status-success">Opp {activeLead.score}</span>
                  {(activeLead as ManagedLead).status && (
                    <span className="text-[12px] text-text-secondary uppercase tracking-wider">{STATUS_LABEL[(activeLead as ManagedLead).status as LeadStatus]}</span>
                  )}
                </div>
              </div>
              <button onClick={() => setActiveLead(null)} className="text-text-muted hover:text-text-primary p-1">✕</button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 my-3 text-[12px]">
              <div className="bg-bg-app p-2 rounded">
                <span className="block text-text-muted uppercase text-[10px] tracking-wider">Property</span>
                <span className="font-medium text-text-primary">Owner Occupied</span>
              </div>
              {storms.length > 0 && (
                <div className="bg-bg-app p-2 rounded">
                  <span className="block text-text-muted uppercase text-[10px] tracking-wider">Storm</span>
                  <span className="font-medium text-status-warning">Recent Hail</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-2">
              <Button variant="primary" full className="text-[12px]" onClick={() => 'id' in activeLead && activeLead.id ? onOpenLead(activeLead.id) : null}>Open Lead 360</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Map Legend Overlay */}
      <div className="absolute top-4 left-4 z-[1000]">
        <Card className="bg-bg-card/90 backdrop-blur-sm p-3 shadow-lg">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2">TERRITORY STATUS</h4>
          <div className="space-y-1.5 text-[11px] font-medium text-text-primary">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: '#20D4F5'}} /> High Opportunity</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: LEGEND_COLOUR['new']}} /> Lead</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: LEGEND_COLOUR['appointment']}} /> Appointment</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{backgroundColor: LEGEND_COLOUR['not_interested']}} /> Not Interested</div>
          </div>
        </Card>
      </div>
    </div>
  )
}
