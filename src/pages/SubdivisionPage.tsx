import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, PageHeader } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'
import { useLiveGPS } from '@/hooks/useLiveGPS'
import { calculateDistanceMiles } from '@/lib/distance'

type StormEvidenceRow = {
  property_id: string;
  hazard_type: string;
  event_time?: string | null;
  event_source?: string | null;
  measurement?: number | null;
  units?: string | null;
  property_distance?: number | null;
  confidence?: string | null;
  evidence_type?: string | null;
};

type PropertyIntelligence = {
  property_id: string;
  lead_id?: string;
  normalized_address: string;
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
  last_visit_date?: string | null;
  distance_miles?: number | null;
  lat?: number | null;
  lng?: number | null;
  subdivision_name?: string | null;
  has_qualifying_storm_evidence?: boolean;
};

export default function SubdivisionPage() {
  const { name } = useParams()
  const decodedName = name ? decodeURIComponent(name) : ''
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [serverProperties, setServerProperties] = useState<PropertyIntelligence[]>([])
  const [stormEvidence, setStormEvidence] = useState<Record<string, StormEvidenceRow[]>>({})

  const { coords, status } = useLiveGPS(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = getSupabase()
      if (!supabase || !decodedName) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase.rpc('get_property_intelligence', {
        p_lat: null, // we want all in the subdivision
        p_lon: null,
        p_max_miles: 50.0,
        p_opportunity_filter: 'ALL',
        p_subdivision_name: decodedName
      })
      
      if (!error && data) {
        const rows = data as PropertyIntelligence[]
        setServerProperties(rows)

        const propertyIds = rows.map((row) => row.property_id).filter(Boolean)
        if (propertyIds.length > 0) {
          const { data: evidenceRows } = await supabase
            .from('property_storm_evidence')
            .select('property_id, hazard_type, event_time, event_source, measurement, units, property_distance, confidence, evidence_type')
            .in('property_id', propertyIds)
            .order('event_time', { ascending: false })

          const grouped: Record<string, StormEvidenceRow[]> = {}
          for (const raw of (evidenceRows ?? []) as StormEvidenceRow[]) {
            if (!grouped[raw.property_id]) grouped[raw.property_id] = []
            grouped[raw.property_id]?.push(raw)
          }
          setStormEvidence(grouped)
        } else {
          setStormEvidence({})
        }
      } else {
        setServerProperties([])
        setStormEvidence({})
      }
      setLoading(false)
    }
    
    void load()
  }, [decodedName])

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
      
      // Sort NEAREST first (based on score + distance)
      result.sort((a, b) => {
        const distA = a.distance_miles ?? 999;
        const distB = b.distance_miles ?? 999;
        return distA - distB;
      });
    }
    
    return result;
  }, [serverProperties, coords]);

  const coverage = {
    total: properties.length,
    visited: properties.filter(p => p.last_visit_date).length,
    contacted: properties.filter(p => p.primary_phone || p.primary_email).length,
  }

  const buildRoute = () => {
    if (properties.length === 0) return;
    const waypoints = properties.slice(0, 9).map(p => `${p.lat},${p.lng}`).join('|');
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${properties[properties.length-1]?.lat},${properties[properties.length-1]?.lng}&waypoints=${waypoints}`, '_blank');
  }

  return (
    <div className="mx-auto max-w-screen-md pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <button onClick={() => navigate(-1)} className="text-sm font-semibold text-brand-primary mb-4">&larr; Back to Leads</button>
        <PageHeader 
          title={decodedName || 'Subdivision'} 
          description={`Coverage: ${coverage.visited} / ${coverage.total} homes visited`} 
        />
        
        <div className="mt-4 mb-6 flex gap-3">
          <button onClick={buildRoute} className="px-4 py-2 bg-brand-primary text-white rounded-lg font-semibold shadow hover:bg-brand-secondary transition-colors">
            Build Route
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {loading ? (
            <div className="text-center py-12 text-sm text-text-muted">Loading subdivision properties...</div>
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
                       {p.opportunity_type === 'MANUAL_LEAD' && <span className="text-[10px] uppercase font-bold text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">MANUAL</span>}
                    </div>
                    <p className="text-sm text-text-secondary truncate mt-0.5">{p.address_line1}</p>
                    
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-text-secondary">📍</span>
                      <span className="font-medium text-text-primary text-sm">
                        {p.distance_miles !== null && p.distance_miles !== undefined ? (
                          <>{p.distance_miles < 1.0 ? p.distance_miles.toFixed(1) : Math.round(p.distance_miles * 10)/10} mi away <span className="text-xs text-text-muted font-normal">· {status === 'LIVE_GPS' ? 'Live GPS' : status === 'IP_FALLBACK' ? 'IP Fallback' : 'Approximate'}</span></>
                        ) : (
                          <span className="text-text-muted italic">Distance unavailable</span>
                        )}
                      </span>
                    </div>
                    
                    {(() => {
                      const evidence = stormEvidence[p.property_id] ?? []
                      const damage = evidence.find((item) => item.evidence_type === 'DAMAGE_REPORT' || item.hazard_type === 'DAMAGE')
                      const ground = evidence.find((item) => item.evidence_type === 'GROUND_REPORT' || item.evidence_type === 'MEASURED')
                      const radar = evidence.find((item) => item.evidence_type === 'RADAR')
                      const best = damage ?? ground ?? radar
                      if (!best) return null

                      const distanceMi =
                        best.property_distance !== null && best.property_distance !== undefined
                          ? best.property_distance < 100
                            ? best.property_distance
                            : best.property_distance * 0.000621371
                          : null

                      const measurement =
                        best.measurement !== null && best.measurement !== undefined
                          ? `${best.measurement}${best.units ? ` ${best.units}` : ''}`
                          : null

                      const label =
                        best.evidence_type === 'DAMAGE_REPORT' || best.hazard_type === 'DAMAGE'
                          ? 'DAMAGE REPORTED NEARBY'
                          : best.evidence_type === 'RADAR'
                            ? 'RADAR EVIDENCE'
                            : 'GROUND REPORT'

                      return (
                        <div className="mt-3 rounded-lg border border-border-subtle bg-bg-elevated/50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-status-warning">{label}</span>
                            {best.confidence && (
                              <span className="text-[10px] uppercase font-semibold text-text-muted">{best.confidence}</span>
                            )}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-text-primary">
                            {best.hazard_type}{measurement ? ` · ${measurement}` : ''}
                          </div>
                          <div className="mt-0.5 text-xs text-text-secondary">
                            {best.event_source || 'Storm evidence source'}
                            {distanceMi !== null ? ` · ${distanceMi.toFixed(distanceMi < 1 ? 1 : 2)} mi from property` : ''}
                          </div>
                          {best.event_time && (
                            <div className="mt-0.5 text-xs text-text-muted">
                              {new Date(best.event_time).toLocaleString()}
                            </div>
                          )}
                          {(best.evidence_type === 'DAMAGE_REPORT' || best.hazard_type === 'DAMAGE') && (
                            <div className="mt-2 text-[11px] text-text-secondary">
                              Nearby damage report — this does not confirm damage to this specific property.
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📞</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone {p.phone_status ? p.phone_status.toLowerCase().replace(/_/g, ' ') : 'not checked'}</span>}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-text-secondary">📧</span>
                        <span className="font-medium text-text-primary">
                          {p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email {p.email_status ? p.email_status.toLowerCase().replace(/_/g, ' ') : 'not checked'}</span>}
                        </span>
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
          )}
        </div>
      </div>
    </div>
  )
}
