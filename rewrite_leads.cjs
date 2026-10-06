const fs = require('fs');
let c = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

c = `import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'
import { useLiveGPS } from '@/hooks/useLiveGPS'
import { calculateDistanceMiles } from '@/lib/distance'

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
  lat?: number | null;
  lng?: number | null;
};

type FilterType = 'ALL' | 'STORM' | 'HAIL' | 'WIND 60+ MPH' | 'AGING ROOF' | 'UNVISITED' | 'ASSIGNED' | 'UNASSIGNED';
type RadiusType = 5 | 10 | 15 | 20 | 'ALL';

export default function LeadsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [serverProperties, setServerProperties] = useState<PropertyIntelligence[]>([])
  const [filter, setFilter] = useState<FilterType>('STORM')
  const [radius, setRadius] = useState<RadiusType>('ALL')
  const [lastFetchedCoords, setLastFetchedCoords] = useState<{lat: number, lon: number} | null>(null)

  const { coords, status, accuracy, timestamp } = useLiveGPS(true)

  useEffect(() => {
    async function load() {
      // Throttle DB calls: Only fetch if we haven't fetched yet, or if radius changed, or if we moved > 1 mile
      let shouldFetch = false;
      if (!lastFetchedCoords && coords) shouldFetch = true;
      if (!coords && !lastFetchedCoords) shouldFetch = true; // initial load without coords
      if (coords && lastFetchedCoords) {
        const dist = calculateDistanceMiles(coords.lat, coords.lon, lastFetchedCoords.lat, lastFetchedCoords.lon);
        if (dist > 1.0) shouldFetch = true;
      }
      
      // We always fetch when filter changes or when radius changes.
      // We'll manage radius client side for small tweaks, but server side is better for big datasets.
      // Actually, we'll fetch whenever filter or radius changes, just to be safe, but we also refine client-side.
      
      setLoading(true)
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const p_max_miles = radius === 'ALL' ? 50.0 : radius;

      const { data, error } = await supabase.rpc('get_property_intelligence', {
        p_lat: coords?.lat || null,
        p_lon: coords?.lon || null,
        p_max_miles: p_max_miles,
        p_opportunity_filter: filter
      })
      
      if (!error && data) {
        setServerProperties(data)
      }
      if (coords) setLastFetchedCoords(coords);
      setLoading(false)
    }
    
    // We want to refetch if filter/radius changes. 
    // We don't refetch on every coords change unless it's > 1 mile.
    void load()
  }, [filter, radius, coords?.lat ? Math.round(coords.lat * 10) : null, coords?.lon ? Math.round(coords.lon * 10) : null])

  // Client-side live distance refinement & sorting
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
      
      // Sort NEAREST first (based on score + distance)
      result.sort((a, b) => {
        // If sorting primarily by distance as requested:
        const distA = a.distance_miles ?? 999;
        const distB = b.distance_miles ?? 999;
        return distA - distB;
      });
    }
    
    return result;
  }, [serverProperties, coords, radius]);

  const filteredProperties = properties;

  return (
    <div className="mx-auto max-w-screen-sm pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader 
          title="Property Intelligence" 
          description="Top ranked properties across your territory." 
        />
        
        {/* Location Status Bar */}
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

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(['ALL', 'STORM', 'HAIL', 'WIND 60+ MPH', 'AGING ROOF', 'UNVISITED', 'ASSIGNED', 'UNASSIGNED'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={\`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors \${filter === f ? 'bg-text-primary text-bg-base' : 'bg-bg-elevated text-text-secondary hover:bg-border-subtle'}\`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-border-subtle">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider mr-2">NEAR ME:</span>
            {([5, 10, 15, 20, 'ALL'] as RadiusType[]).map((r) => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={\`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors \${radius === r ? 'bg-brand-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-border-subtle'}\`}
              >
                {r === 'ALL' ? 'All' : \`\${r} mi\`}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {loading && filteredProperties.length === 0 ? (
            <div className="text-center py-12 text-sm text-text-muted">Distance resolving...</div>
          ) : filteredProperties.length === 0 ? (
            <Empty 
              title="No leads found" 
              description="No properties match your current filters and radius."
            />
          ) : (
            filteredProperties.map((p) => (
              <Card key={p.property_id} className="flex flex-col overflow-hidden">
                <div className="p-4 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-display font-semibold text-text-primary truncate">
                      {p.owner_name || 'Owner Unknown'}
                    </h3>
                    <p className="text-sm text-text-secondary truncate mt-0.5">{p.address_line1}</p>
                    
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📍</span>
                        <span className="font-medium text-text-primary">
                          {p.distance_miles !== null && p.distance_miles !== undefined ? (
                            <>{p.distance_miles < 1.0 ? p.distance_miles.toFixed(1) : Math.round(p.distance_miles * 10)/10} mi away <span className="text-xs text-text-muted font-normal">· {status === 'LIVE_GPS' ? 'Live GPS' : 'Approximate'}</span></>
                          ) : (
                            <span className="text-text-muted italic">Distance unavailable</span>
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

                <div className="bg-bg-elevated p-4 text-sm text-text-secondary flex-1 border-t border-border-subtle">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-xs uppercase tracking-wider font-semibold text-text-muted mb-1">Roof Intelligence</span>
                      {p.roof_age_years ? (
                        <>
                          <p className="font-medium text-text-primary">~{p.roof_age_years} yrs old</p>
                          <p className="text-xs text-text-muted mt-0.5 truncate">{p.last_roof_permit_date ? \`Last reroof: \${p.last_roof_permit_date.split('-')[0]}\` : ''}</p>
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
                </div>

                <div className="flex bg-bg-base border-t border-border-subtle divide-x divide-border-subtle">
                  <button 
                    onClick={() => navigate('/leads/' + (p.lead_id || p.property_id))}
                    className="flex-1 py-3 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition-colors"
                  >
                    Open Lead
                  </button>
                  <a 
                    href={p.primary_phone ? \`tel:\${p.primary_phone.replace(/[^0-9]/g, '')}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Call
                  </a>
                  <a 
                    href={p.primary_phone ? \`sms:\${p.primary_phone.replace(/[^0-9]/g, '')}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_phone ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_phone) e.preventDefault(); }}
                  >
                    Text
                  </a>
                  <a 
                    href={p.primary_email ? \`mailto:\${p.primary_email}\` : undefined}
                    className={\`flex-1 py-3 text-xs font-semibold transition-colors text-center \${p.primary_email ? 'text-brand-primary hover:bg-brand-primary/5' : 'text-text-muted cursor-not-allowed opacity-50'}\`}
                    onClick={(e) => { if (!p.primary_email) e.preventDefault(); }}
                  >
                    Email
                  </a>
                  <a 
                    href={p.lat && p.lng ? \`https://www.google.com/maps/dir/?api=1&destination=\${p.lat},\${p.lng}\` : \`https://www.google.com/maps/dir/?api=1&destination=\${encodeURIComponent(p.address_line1 + ', ' + p.city)}\`}
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
`
fs.writeFileSync('src/pages/LeadsPage.tsx', c);
