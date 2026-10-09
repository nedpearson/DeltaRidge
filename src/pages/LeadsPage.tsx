import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader } from '@/components/ui'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getSupabase } from '@/lib/supabase'
import { useLiveGPS } from '@/hooks/useLiveGPS'
import { calculateDistanceMiles } from '@/lib/distance'

type PropertyIntelligence = {
  property_id: string;
  lead_id?: string;
  address_line1: string;
  city: string;
  opportunity_type: string;
  owner_name?: string | null;
  roof_age_years?: number | null;
  last_roof_permit_date?: string | null;
  max_wind?: number | null;
  max_hail?: number | null;
  opportunity_score: number;
  assigned_to_name?: string | null;
  primary_phone?: string | null;
  phone_status?: string | null;
  primary_email?: string | null;
  email_status?: string | null;
  distance_miles?: number | null;
  lat?: number | null;
  lng?: number | null;
  has_qualifying_storm_evidence?: boolean;
};

type SubdivisionIntelligence = {
  subdivision_name: string;
  subdivision_source: string;
  distance_miles: number;
  total_opportunities: number;
  storm_leads: number;
  aging_roof_leads: number;
  unvisited_leads: number;
  unassigned_leads: number;
  phone_found: number;
  email_found: number;
  average_score: number;
  top_score: number;
  latest_storm: string;
  max_wind: number;
  max_hail: number;
  subdivision_score: number;
};

type FilterType = 'ALL' | 'STORM' | 'HAIL' | 'WIND 60+ MPH' | 'AGING ROOF' | 'PERMIT GAP' | 'UNVISITED' | 'ASSIGNED' | 'UNASSIGNED';
type RadiusType = 5 | 10 | 15 | 20 | 'ALL';
type ViewMode = 'PROPERTIES' | 'SUBDIVISIONS';

export default function LeadsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [serverProperties, setServerProperties] = useState<PropertyIntelligence[]>([])
  const [serverSubdivisions, setServerSubdivisions] = useState<SubdivisionIntelligence[]>([])
  const [filter, setFilter] = useState<FilterType>('STORM')
  const [radius, setRadius] = useState<RadiusType>('ALL')
  const [viewMode, setViewMode] = useState<ViewMode>('SUBDIVISIONS')

  const { coords, status, accuracy } = useLiveGPS(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const p_max_miles = radius === 'ALL' ? 999999.0 : radius;

      if (viewMode === 'PROPERTIES') {
        const { data, error } = await supabase.rpc('get_property_intelligence', {
          p_lat: coords?.lat || null,
          p_lon: coords?.lon || null,
          p_max_miles: p_max_miles,
          p_opportunity_filter: filter
        })
        if (!error && data) setServerProperties(data)
      } else {
        const { data, error } = await supabase.rpc('get_subdivisions_intelligence', {
          p_lat: coords?.lat || null,
          p_lon: coords?.lon || null,
          p_max_miles: p_max_miles,
          p_opportunity_filter: filter
        })
        if (!error && data) setServerSubdivisions(data)
      }
      
      setLoading(false)
    }
    
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, radius, viewMode, coords?.lat ? Math.round(coords.lat * 10) : null, coords?.lon ? Math.round(coords.lon * 10) : null])

  const properties = useMemo(() => {
    let result = [...serverProperties];
    if (coords) {
      result = result.map(p => {
        if (p.lat && p.lng) {
          return { ...p, distance_miles: calculateDistanceMiles(coords.lat, coords.lon, p.lat, p.lng) };
        }
        return p;
      });
      if (radius !== 'ALL') {
        result = result.filter(p => p.distance_miles !== null && p.distance_miles !== undefined && p.distance_miles <= radius);
      }
      result.sort((a, b) => (a.distance_miles ?? 999) - (b.distance_miles ?? 999));
    }
    return result;
  }, [serverProperties, coords, radius]);

  const subdivisions = useMemo(() => {
    let result = [...serverSubdivisions];
    // Distance refinement could be done here if we had subdivision centroids, but since we rely on server distance min(), we just filter it.
    if (radius !== 'ALL') {
       result = result.filter(s => s.distance_miles <= radius);
    }
    return result;
  }, [serverSubdivisions, radius]);

  return (
    <ErrorBoundary>
    <div className="mx-auto max-w-screen-sm pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader 
          title="Property Intelligence" 
          description={viewMode === 'SUBDIVISIONS' ? "Best areas to work right now." : "Top ranked properties across your territory."} 
        />
        
        <div className="mt-4 mb-4 flex bg-bg-elevated p-1 rounded-lg border border-border-subtle">
          <button 
            className={`flex-1 py-1.5 text-xs font-bold uppercase rounded-md transition-colors ${viewMode === 'SUBDIVISIONS' ? 'bg-bg-base shadow text-brand-primary' : 'text-text-secondary hover:text-text-primary'}`}
            onClick={() => setViewMode('SUBDIVISIONS')}
          >
            Subdivisions
          </button>
          <button 
            className={`flex-1 py-1.5 text-xs font-bold uppercase rounded-md transition-colors ${viewMode === 'PROPERTIES' ? 'bg-bg-base shadow text-brand-primary' : 'text-text-secondary hover:text-text-primary'}`}
            onClick={() => setViewMode('PROPERTIES')}
          >
            Properties
          </button>
        </div>

        <div className="mb-4 text-xs font-medium bg-bg-elevated px-3 py-2 rounded-lg flex items-center justify-between border border-border-subtle">
          <div className="flex items-center gap-2">
            <span className={status === 'LIVE_GPS' ? 'text-green-500' : 'text-brand-primary'}>●</span>
            <span className="text-text-secondary">
              {status === 'REQUESTING_PERMISSION' && 'Requesting GPS permission...'}
              {status === 'LIVE_GPS' && 'Live GPS Active'}
              {status === 'PERMISSION_DENIED' && 'GPS Permission Denied'}
              {status === 'POSITION_UNAVAILABLE' && 'GPS Position Unavailable'}
              {status === 'TIMEOUT' && 'GPS Timeout'}
              {status === 'ERROR' && 'GPS Error'}
              {status === 'IDLE' && 'GPS Idle'}
            </span>
          </div>
          {status === 'LIVE_GPS' && accuracy && (
            <span className="text-text-muted">±{Math.round(accuracy)}m</span>
          )}
        </div>

        {status === 'PERMISSION_DENIED' && (
          <div className="mb-4 bg-brand-primary/10 border border-brand-primary/20 rounded-lg p-3">
            <h4 className="font-bold text-brand-primary text-sm mb-1">Enable Location for Nearby Leads</h4>
            <p className="text-xs text-text-secondary">Location is used to calculate your distance to properties and build efficient field routes.</p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider mr-2">NEAR ME:</span>
            {([5, 10, 15, 20, 'ALL'] as RadiusType[]).map((r) => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${radius === r ? 'bg-brand-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-border-subtle hover:text-text-primary'}`}
              >
                {r === 'ALL' ? 'All' : `${r} mi`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border-subtle">
            {(['ALL', 'STORM', 'HAIL', 'WIND 60+ MPH', 'AGING ROOF', 'PERMIT GAP', 'UNVISITED', 'ASSIGNED', 'UNASSIGNED'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${filter === f ? 'bg-brand-primary text-white shadow-sm' : 'bg-bg-elevated text-text-secondary hover:bg-border-subtle'}`}
              >
                {f}
              </button>
            ))}
          </div>
          
          <div className="text-xs text-text-muted font-medium py-1">
             SHOWING: {viewMode === 'PROPERTIES' ? properties.length : subdivisions.length} {viewMode} WITHIN {radius === 'ALL' ? '50' : radius} MILES
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {loading ? (
            <div className="text-center py-12 text-sm text-text-muted">Loading intelligence...</div>
          ) : viewMode === 'PROPERTIES' ? (
             properties.length === 0 ? (
                <Empty 
                  title="No leads found" 
                  body="No properties match your current filters and radius."
                />
             ) : (
                properties.map((p) => (
                  <Card key={p.property_id} className="flex flex-col overflow-hidden">
                    <div className="p-4 flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                           <h3 className="text-lg font-display font-semibold text-text-primary truncate">
                             {p.owner_name || 'Owner Unknown'}
                           </h3>
                           {p.has_qualifying_storm_evidence && <span className="text-[10px] uppercase font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">STORM</span>}
                           {p.opportunity_type === 'AGING_ROOF' && <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">AGING ROOF</span>}
                           {p.opportunity_type === 'PERMIT_GAP' && <span className="text-[10px] uppercase font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">PERMIT GAP</span>}
                           {p.opportunity_type === 'MANUAL_LEAD' && <span className="text-[10px] uppercase font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">MANUAL</span>}
                        </div>
                        <p className="text-sm text-text-secondary truncate mt-0.5">{p.address_line1}</p>
                        
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-text-secondary">📍</span>
                          <span className="font-medium text-text-primary text-sm">
                            {p.distance_miles !== null && p.distance_miles !== undefined ? (
                              <>{p.distance_miles < 1.0 ? p.distance_miles.toFixed(1) : Math.round(p.distance_miles * 10)/10} mi away <span className="text-xs text-text-muted font-normal">· {status === 'LIVE_GPS' ? 'Live GPS' : status === 'IP_FALLBACK' ? 'IP Fallback' : 'Approximate'}</span></>
                            ) : (
                              status === 'REQUESTING_PERMISSION' ? <span className="text-text-muted italic">Locating...</span> : <span className="text-text-muted italic">Distance unavailable &middot; {status === 'PERMISSION_DENIED' ? 'Location permission denied' : status === 'TIMEOUT' ? 'GPS timed out' : status === 'POSITION_UNAVAILABLE' ? 'GPS unavailable' : !p.lat || !p.lng ? 'Property coordinates missing' : 'Location unknown'}</span>
                            )}
                          </span>
                        </div>

                        <div className="mt-3 space-y-1.5 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-text-secondary">📞</span>
                            <span className="font-medium text-text-primary">
                              {p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone {p.phone_status ? p.phone_status.toLowerCase().replace(/_/g, " ") : "not checked"}</span>}
                            </span>
                            {p.phone_status && p.phone_status !== "NOT_FOUND" && p.phone_status !== "NOT_CHECKED" && p.phone_status !== "PROVIDER_NOT_CONFIGURED" && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.phone_status}</span>}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-text-secondary">📧</span>
                            <span className="font-medium text-text-primary">
                              {p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email {p.email_status ? p.email_status.toLowerCase().replace(/_/g, " ") : "not checked"}</span>}
                            </span>
                            {p.email_status && p.email_status !== "NOT_FOUND" && p.email_status !== "NOT_CHECKED" && p.email_status !== "PROVIDER_NOT_CONFIGURED" && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.email_status}</span>}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right flex flex-col items-end">
                        <div className="flex items-baseline gap-1 bg-brand-primary/10 px-3 py-1 rounded-lg">
                          <span className="text-2xl font-display font-bold text-brand-primary">{p.opportunity_score}</span>
                          <span className="text-[10px] uppercase font-bold text-brand-primary/70">Score</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex bg-bg-base border-t border-border-subtle divide-x divide-border-subtle">
                      <button onClick={() => navigate('/leads/' + (p.lead_id || p.property_id))} className="flex-1 py-3 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition-colors">
                        Open Lead
                      </button>
                      <a href={p.primary_phone ? `tel:${p.primary_phone.replace(/[^0-9]/g, '')}` : undefined} className={`flex-1 py-3 text-xs font-semibold transition-colors text-center ${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}`} onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}>Call</a>
                    </div>
                  </Card>
                ))
             )
          ) : (
             subdivisions.length === 0 ? (
                <Empty 
                  title="No subdivisions found" 
                  body="No area clusters match your current filters and radius."
                />
             ) : (
                subdivisions.map((s, i) => (
                  <div key={s.subdivision_name} onClick={() => navigate('/subdivisions/' + encodeURIComponent(s.subdivision_name))} className="cursor-pointer">
                  <Card className="flex flex-col overflow-hidden hover:border-brand-primary/30 transition-colors">
                    <div className="p-4">
                      <div className="flex justify-between items-start gap-4">
                         <div className="flex-1 min-w-0">
                           <h3 className="text-lg font-display font-semibold text-brand-primary truncate">
                             {i + 1}. {s.subdivision_name}
                           </h3>
                           <p className="text-xs text-text-muted mt-0.5">Source: {s.subdivision_source}</p>
                           
                           <div className="mt-3 flex gap-4 text-sm">
                              <div>
                                 <p className="font-bold text-text-primary">{s.total_opportunities}</p>
                                 <p className="text-xs text-text-secondary">Opportunities</p>
                              </div>
                              <div>
                                 <p className="font-bold text-text-primary">{s.distance_miles !== null && s.distance_miles !== undefined ? (s.distance_miles < 1 ? s.distance_miles.toFixed(1) : Math.round(s.distance_miles * 10) / 10) : '--'} mi</p>
                                 <p className="text-xs text-text-secondary">Distance</p>
                              </div>
                              <div>
                                 <p className="font-bold text-text-primary">{Math.round(s.subdivision_score)}</p>
                                 <p className="text-xs text-text-secondary">Area Score</p>
                              </div>
                           </div>
                         </div>
                      </div>
                      
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs border-t border-border-subtle pt-3">
                         <div>
                            <span className="block text-text-muted uppercase tracking-wider font-semibold mb-1">Lead Mix</span>
                            <ul className="space-y-0.5 text-text-secondary">
                               {s.storm_leads > 0 && <li>• {s.storm_leads} storm-qualified</li>}
                               {s.aging_roof_leads > 0 && <li>• {s.aging_roof_leads} aging roof</li>}
                               {s.unvisited_leads > 0 && <li>• {s.unvisited_leads} unvisited</li>}
                            </ul>
                         </div>
                         <div>
                            <span className="block text-text-muted uppercase tracking-wider font-semibold mb-1">Contact Coverage</span>
                            <ul className="space-y-0.5 text-text-secondary">
                               <li>• {s.phone_found} / {s.total_opportunities} phones</li>
                               <li>• {s.email_found} / {s.total_opportunities} emails</li>
                               {s.max_wind >= 60 && <li className="text-brand-primary font-medium mt-1">✓ {s.max_wind} MPH wind</li>}
                               {s.max_hail >= 1.0 && <li className="text-brand-primary font-medium mt-1">✓ {s.max_hail}" hail</li>}
                            </ul>
                         </div>
                      </div>
                    </div>
                  </Card>
                  </div>
                ))
             )
          )}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}
