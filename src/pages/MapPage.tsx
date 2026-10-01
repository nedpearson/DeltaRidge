import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { readLeads } from '@/features/leads/lead-store'
import { currentPosition } from '@/lib/image'

// Fix Leaflet's default icon path issues in React
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
})

const LeadPin = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%234776E6"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>'),
  iconSize: [30, 30],
  iconAnchor: [15, 30]
})

const UserPin = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#3b82f6" stroke="#ffffff" stroke-width="3" /><circle cx="12" cy="12" r="12" fill="#3b82f6" fill-opacity="0.2" /></svg>'),
  iconSize: [24, 24],
  iconAnchor: [12, 12]
})

const JobPin = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2334C990"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>'),
  iconSize: [30, 30],
  iconAnchor: [15, 30]
})

interface MappableLead {
  id: string
  address: string
  status: string
  score: number
  latitude: number
  longitude: number
}

/** Fits the map to the current marker bounds */
function FitToMarkers({ leads }: { leads: MappableLead[] }) {
  const map = useMap()
  useEffect(() => {
    if (leads.length === 0) return
    const bounds = L.latLngBounds(leads.map(l => [l.latitude, l.longitude]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
  }, [leads, map])
  return null
}

function FocusLead({ lead }: { lead: MappableLead | null }) {
  const map = useMap()
  useEffect(() => {
    if (!lead) return
    map.setView([lead.latitude, lead.longitude], 17)
  }, [lead, map])
  return null
}

/** Centers map on the user's actual GPS position when no explicit lead is focused. */
function CenterOnDevice({ enabled, setMyLoc }: { enabled: boolean, setMyLoc: (loc: [number, number]) => void }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled) return
    let mounted = true
    import('@/lib/image').then(({ currentPosition }) => {
      currentPosition(5000, true).then((pos) => {
        if (!mounted || !pos) return
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        setMyLoc([lat, lon])
        map.setView([lat, lon], 14)
      })
    })
    return () => { mounted = false }
  }, [enabled, map, setMyLoc])
  return null
}

export default function MapPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [leads, setLeads] = useState<MappableLead[]>([])
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'jobs'>('all')
  const [noCoordinateCount, setNoCoordinateCount] = useState(0)
  const [myLoc, setMyLoc] = useState<[number, number] | null>(null)

  useEffect(() => {
    readLeads().then(data => {
      let skipped = 0
      const mapped: MappableLead[] = []

      for (const lead of data) {
        // Only plot leads that have real, canonical coordinates from the property record.
        // Never generate fake coordinates.
        const lat = typeof lead.latitude === 'number' ? lead.latitude : null
        const lng = typeof lead.longitude === 'number' ? lead.longitude : null

        if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
          mapped.push({ id: lead.id, address: lead.address, status: lead.status, score: lead.score, latitude: lat, longitude: lng })
        } else {
          skipped++
        }
      }

      setLeads(mapped)
      setNoCoordinateCount(skipped)
    })
  }, [])

  const focusId = searchParams.get('focus')
  const focusLead = focusId ? leads.find((lead) => lead.id === focusId) ?? null : null

  const filteredLeads = leads.filter(l => {
    if (filter === 'all') return true
    if (filter === 'jobs') return l.status === 'won'
    return l.status !== 'won'
  })

  return (
    <div className="relative flex h-[calc(100dvh-var(--app-header-height,0px)-var(--bottom-nav-height,0px))] min-h-[28rem] flex-col overflow-hidden bg-bg-page">
      {/* Filter controls */}
      <div className="absolute left-3 right-3 top-3 z-[400] flex gap-2 overflow-x-auto pb-1 sm:left-4 sm:right-4 sm:top-4">
        <Button variant={filter === 'all' ? 'primary' : 'secondary'} className="shrink-0 !min-h-10 !px-3 !py-2 text-xs shadow-lg" onClick={() => setFilter('all')}>All ({leads.length})</Button>
        <Button variant={filter === 'opportunities' ? 'primary' : 'secondary'} className="shrink-0 !min-h-10 !px-3 !py-2 text-xs shadow-lg" onClick={() => setFilter('opportunities')}>Opportunities</Button>
        <Button variant={filter === 'jobs' ? 'primary' : 'secondary'} className="shrink-0 !min-h-10 !px-3 !py-2 text-xs shadow-lg" onClick={() => setFilter('jobs')}>Completed Jobs</Button>
      </div>

      {/* Warning banner for leads missing coordinates */}
      {noCoordinateCount > 0 && (
        <div className="absolute left-3 right-3 top-16 z-[400] rounded-xl border border-status-warning/40 bg-bg-card/95 px-3 py-2 text-[11px] text-text-secondary backdrop-blur sm:left-4 sm:right-4">
          <span className="text-status-warning font-bold">{noCoordinateCount} leads</span> not shown — missing property coordinates.
        </div>
      )}

      <MapContainer
        center={[30.4515, -91.1871]}
        zoom={10}
        className="w-full flex-1 z-0"
        zoomControl={false}
      >
        {/* Standard street tiles — no EagleView attribution unless EagleView tiles are configured */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <CenterOnDevice enabled={focusLead === null} setMyLoc={setMyLoc} />
        {myLoc && <Marker position={myLoc} icon={UserPin} zIndexOffset={1000} />}
        <FocusLead lead={focusLead} />
        {focusLead === null && filteredLeads.length > 0 && <FitToMarkers leads={filteredLeads} />}

        {filteredLeads.map(lead => (
          <Marker eventHandlers={{ click: () => navigate('/lead/' + lead.id) }}
            key={lead.id}
            position={[lead.latitude, lead.longitude]}
            icon={lead.status === 'won' ? JobPin : LeadPin}
          >
            <Popup>
              <div className="p-2 min-w-[200px]">
                <span className={lead.status === 'won'
                  ? 'bg-green-100 text-green-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm mb-2 inline-block'
                  : 'bg-blue-100 text-blue-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm mb-2 inline-block'
                }>
                  {lead.status === 'won' ? 'Completed Job' : 'Opportunity'}
                </span>
                <h3 className="font-bold text-[14px] mt-1">{lead.address}</h3>
                <p className="text-[12px] text-gray-600 mt-1">Score: {lead.score}</p>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    className="w-full text-[11px]"
                    onClick={() => navigate('/lead/' + lead.id)}
                  >
                    Open Lead 360
                  </Button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
