import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'


type PropertyScore = {
  property_id: string;
  max_wind?: number;
  max_hail?: number;
  opportunity_score: number;
  assigned_to?: string | null;
  address_line1: string;
  city: string;
  normalized_address: string;
  distance_miles?: number;
};

type FilterType = 'ALL' | 'HAIL' | 'WIND 60+ MPH' | 'ASSIGNED' | 'UNASSIGNED';

export default function LeadsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<PropertyScore[]>([])
  const [filter, setFilter] = useState<FilterType>('ALL')
  const [locating, setLocating] = useState(false)
  const [coords, setCoords] = useState<{lat: number, lon: number} | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase.rpc('get_nearby_opportunities', {
        p_lat: coords?.lat || null,
        p_lon: coords?.lon || null,
        p_max_miles: 50.0
      })
      
      if (!error && data) {
        setProperties(data)
      }
      setLoading(false)
    }
    void load()
  }, [coords])

  const requestLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocating(false)
      },
      (err) => {
        console.error('Geolocation error:', err)
        alert('Could not get your location. Please check your browser permissions.')
        setLocating(false)
      }
    )
  }

  const filteredProperties = properties.filter(p => {
    if (filter === 'HAIL') return p.max_hail && p.max_hail > 0;
    if (filter === 'WIND 60+ MPH') return p.max_wind && p.max_wind >= 60;
    if (filter === 'ASSIGNED') return p.assigned_to != null;
    if (filter === 'UNASSIGNED') return p.assigned_to == null;
    return true;
  });

  return (
    <div className="mx-auto max-w-screen-sm pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader 
          title="Storm Opportunities" 
          description="Top ranked properties affected by recent storm events." 
        />
        
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {(['ALL', 'HAIL', 'WIND 60+ MPH', 'ASSIGNED', 'UNASSIGNED'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${filter === f ? 'bg-brand-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-border-subtle ring-1 ring-inset ring-border-subtle'}`}
              >
                {f}
              </button>
            ))}
          </div>

          <button
            onClick={requestLocation}
            disabled={locating || !!coords}
            className="flex items-center gap-2 rounded-full bg-bg-elevated px-4 py-1.5 text-xs font-semibold text-text-primary ring-1 ring-inset ring-border-subtle hover:bg-border-subtle transition-colors disabled:opacity-50"
          >
            {locating ? 'Locating...' : coords ? 'GPS Active' : '📍 Sort by Distance'}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading opportunities...</p>
          ) : filteredProperties.length === 0 ? (
            <Empty title="No opportunities found" body="No properties match the selected filter." />
          ) : (
            filteredProperties.map(p => (
              <div key={p.property_id} onClick={() => navigate('/property/' + p.normalized_address)} className="cursor-pointer group">
                <Card className="group-hover:bg-bg-elevated transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-text-primary">{p.address_line1 || `Property ID: ${p.property_id.substring(0, 8)}`}</h3>
                      <p className="text-xs text-text-secondary mt-0.5">{p.city}</p>
                      <p className="text-sm text-text-secondary mt-1.5 flex gap-2">
                        {p.max_wind ? <span>💨 {p.max_wind} MPH</span> : null} 
                        {p.max_hail ? <span>🧊 {p.max_hail}"</span> : null}
                        {p.distance_miles !== null && p.distance_miles !== undefined && (
                          <span>📍 {p.distance_miles.toFixed(1)} mi</span>
                        )}
                      </p>
                      {p.assigned_to && (
                        <p className="text-xs text-brand-primary mt-1">● Assigned</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-display font-bold text-brand-primary">{p.opportunity_score}</span>
                      <p className="text-[10px] uppercase text-text-muted mt-0.5 tracking-wider">Score</p>
                    </div>
                  </div>
                </Card>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
