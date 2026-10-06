import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

type PropertyIntelligence = {
  property_id: string;
  lead_id?: string;
  normalized_address: string;
  address_line1: string;
  city: string;
  opportunity_type: string;
  owner_name?: string | null;
  owner_source?: string | null;
  roof_age_years?: number | null;
  roof_age_source?: string | null;
  last_roof_permit_date?: string | null;
  last_roof_permit_desc?: string | null;
  last_roof_permit_source?: string | null;
  max_wind?: number | null;
  max_hail?: number | null;
  latest_storm_date?: string | null;
  storm_distance_miles?: number | null;
  opportunity_score: number;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  lead_status?: string | null;
  primary_phone?: string | null;
  phone_status?: string | null;
  primary_email?: string | null;
  email_status?: string | null;
  last_contact_date?: string | null;
  last_visit_date?: string | null;
  distance_miles?: number | null;
};

type FilterType = 'ALL' | 'STORM' | 'HAIL' | 'WIND 60+ MPH' | 'AGING ROOF' | 'UNVISITED' | 'ASSIGNED' | 'UNASSIGNED';

export default function LeadsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<PropertyIntelligence[]>([])
  const [filter, setFilter] = useState<FilterType>('STORM')
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

      const { data, error } = await supabase.rpc('get_property_intelligence', {
        p_lat: coords?.lat || null,
        p_lon: coords?.lon || null,
        p_max_miles: 50.0,
        p_opportunity_filter: filter
      })
      
      if (!error && data) {
        setProperties(data)
      }
      setLoading(false)
    }
    void load()
  }, [coords, filter])

  const requestLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocating(false)
      },
      (err) => {
        console.error('Geolocation error:', err)
        console.warn('Could not get your location. Please check your browser permissions.')
        setLocating(false)
      }
    )
  }

  const filteredProperties = properties;

  return (
    <div className="mx-auto max-w-screen-sm pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader 
          title="Property Intelligence" 
          description="Top ranked properties across your territory." 
        />
        
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(['ALL', 'STORM', 'HAIL', 'WIND 60+ MPH', 'AGING ROOF', 'UNVISITED', 'ASSIGNED', 'UNASSIGNED'] as FilterType[]).map((f) => (
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

        <div className="mt-4 space-y-4">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading intelligence...</p>
          ) : filteredProperties.length === 0 ? (
            <Empty title="No opportunities found" body="No properties match the selected filter." />
          ) : (
                                    filteredProperties.map(p => (
              <Card key={p.property_id} className="p-0 overflow-hidden border-border-subtle flex flex-col">
                <div className="p-4 bg-bg-base border-b border-border-subtle flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">
                      {p.owner_name === 'Jane Smith' ? 'DEMO - Jane Smith' : (p.owner_name || 'Owner not found')}
                    </h3>
                    <p className="text-sm font-medium text-text-secondary mt-0.5">
                      {p.address_line1}, {p.city}
                    </p>
                    
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📍</span>
                        <span className="font-medium text-text-primary">
                          {p.distance_miles !== null && p.distance_miles !== undefined ? (
                            <>{p.distance_miles.toFixed(1)} mi away <span className="text-xs text-text-muted font-normal">({coords ? 'Live GPS' : 'Approximate'})</span></>
                          ) : (
                            <span className="text-text-muted italic">Distance unavailable (Location permission required)</span>
                          )}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📞</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone not found</span>}
                        </span>
                        {p.phone_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.phone_status}</span>}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📧</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email not found</span>}
                        </span>
                        {p.email_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.email_status}</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-baseline gap-1 bg-brand-primary/10 px-3 py-1 rounded-lg">
                      <span className="text-2xl font-display font-bold text-brand-primary">{p.opportunity_score}</span>
                      <span className="text-[10px] uppercase font-bold text-brand-primary/70">Score</span>
                    </div>
                    {p.assigned_to_name && (
                      <p className="text-xs font-medium text-text-secondary mt-2">● {p.assigned_to_name}</p>
                    )}
                  </div>
                </div>

                <div className="bg-bg-elevated p-4 text-sm text-text-secondary flex-1">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Roof Intelligence</span>
                      {p.roof_age_years ? (
                        <>
                          <p className="font-medium text-text-primary">~{p.roof_age_years} yrs old</p>
                          <p className="text-xs text-text-muted mt-0.5 truncate">{p.roof_age_source || 'Unknown source'}</p>
                        </>
                      ) : (
                        <p className="italic text-text-muted">Unknown • no permit found</p>
                      )}
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Storm Evidence</span>
                      {(p.max_wind || p.max_hail) ? (
                        <>
                          {p.max_hail ? (
                            <p className="font-medium text-text-primary text-xs mb-1">
                              RADAR<br/>{p.max_hail}" estimated hail<br/>
                              <span className="text-text-muted">MRMS • 0.0 mi away</span>
                            </p>
                          ) : null}
                          {p.max_wind ? (
                            <p className="font-medium text-text-primary text-xs">
                              GROUND REPORT<br/>{p.max_wind} MPH measured gust<br/>
                              <span className="text-text-muted">NWS LSR • 0.0 mi away</span>
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="italic text-text-muted font-bold">NO QUALIFYING STORM EVIDENCE</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border-subtle">
                     <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-2">Why this lead?</span>
                     <ul className="space-y-1">
                        {p.roof_age_years && p.roof_age_years >= 15 && <li>• {p.roof_age_years}-year roof</li>}
                        {!p.roof_age_years && <li>• No recent re-roof permit</li>}
                        {p.max_wind && p.max_wind >= 60 && <li>• {p.max_wind} MPH wind exposure</li>}
                        {p.max_hail && p.max_hail >= 1.0 && <li>• {p.max_hail}" hail exposure</li>}
                        {!p.last_visit_date && <li>• Unvisited</li>}
                     </ul>
                  </div>
                </div>

                <div className="flex bg-bg-base border-t border-border-subtle divide-x divide-border-subtle">
                  <button 
                    onClick={() => navigate('/leads/' + (p.lead_id || p.property_id))}
                    className="flex-1 py-3 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition-colors"
                  >
                    Open Lead
                  </button>
                  <a 
                    href={p.primary_phone ? `tel:${p.primary_phone.replace(/[^0-9]/g, '')}` : undefined}
                    className={`flex-1 py-3 text-xs font-semibold transition-colors text-center ${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Call
                  </a>
                  <a 
                    href={p.primary_phone ? `sms:${p.primary_phone.replace(/[^0-9]/g, '')}` : undefined}
                    className={`flex-1 py-3 text-xs font-semibold transition-colors text-center ${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Text
                  </a>
                  <a 
                    href={p.primary_email ? `mailto:${p.primary_email}` : undefined}
                    className={`flex-1 py-3 text-xs font-semibold transition-colors text-center ${p.primary_email ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}`}
                    onClick={(e) => { if (!p.primary_email) e.preventDefault(); }}
                  >
                    Email
                  </a>
                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address_line1 + ', ' + p.city)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-3 text-xs font-semibold text-text-secondary hover:bg-bg-elevated transition-colors text-center"
                  >
                    Navigate
                  </a>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
