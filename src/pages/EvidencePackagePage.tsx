import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { readLead } from '@/features/leads/lead-store'
import type { ManagedLead } from '@/features/leads/pipeline'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { distanceMiles } from '@/features/leads/scoring'
import { buildPropertyProfile, type PropertyProfile } from '@/features/leads/property-profile'
import { listPhotos, type LocalPhoto } from '@/lib/db'
import { EagleViewImageryProvider } from '@/features/imagery/eagleview'
import { rankCaptures } from '@/features/imagery/selection'
import type { ImageryCapture } from '@/features/imagery/types'

function EvidencePhoto({ photo }: { photo: LocalPhoto }) {
  const [url, setUrl] = useState<string | null>(null)
  
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [photo])
  
  if (!url) return null
  
  return (
    <div className="mb-4 break-inside-avoid">
      <img src={url} alt={photo.category || 'Inspection Photo'} className="w-full h-auto rounded object-cover" />
      {photo.category && <p className="mt-1 text-sm font-semibold">{photo.category.replace(/_/g, ' ').toUpperCase()}</p>}
      {photo.caption && <p className="text-sm text-gray-700">{photo.caption}</p>}
    </div>
  )
}

function EagleViewPhoto({ capture, latitude, longitude }: { capture: ImageryCapture, latitude: number, longitude: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    const provider = new EagleViewImageryProvider()
    let active = true
    let objectUrl: string | null = null
    
    provider.image(capture, { latitude, longitude })
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Error loading image')
      })
      
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [capture, latitude, longitude])
  
  if (error) return <p className="text-red-500 text-sm">{error}</p>
  if (!url) return <p className="text-sm text-gray-500">Loading EagleView imagery...</p>
  
  return (
    <div className="mb-4 break-inside-avoid">
      <img src={url} alt="EagleView Roof Capture" className="w-full h-auto rounded object-cover" />
      <p className="mt-1 text-sm font-semibold">EAGLEVIEW SATELLITE IMAGERY</p>
      <p className="text-sm text-gray-700">Captured: {new Date(capture.capturedUntil || capture.capturedFrom || '').toLocaleDateString()}</p>
    </div>
  )
}

export default function EvidencePackagePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [lead, setLead] = useState<ManagedLead | null>(null)
  const [run, setRun] = useState<LeadRun | null>(null)
  const [profile, setProfile] = useState<PropertyProfile | null>(null)
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [eagleViewCapture, setEagleViewCapture] = useState<ImageryCapture | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      if (!id) return
      
      const foundLead = await readLead(id)
      setLead(foundLead ?? null)
      
      const cachedRun = await readCachedRun()
      setRun(cachedRun ?? null)
      
      if (foundLead) {
        if (foundLead.inspectionId) {
          const loadedPhotos = await listPhotos(foundLead.inspectionId)
          setPhotos(loadedPhotos)
        }
        
        try {
          const provider = new EagleViewImageryProvider()
          const result = await provider.searchCaptures({ latitude: foundLead.latitude, longitude: foundLead.longitude })
          const ranked = rankCaptures(result.captures)
          if (ranked.length > 0) {
            setEagleViewCapture(ranked[0])
          }
        } catch (e) {
          console.error("EagleView fetch failed", e)
        }
      }
      
      setLoading(false)
    }
    
    void loadData()
  }, [id])
  
  useEffect(() => {
    if (lead && run) {
      const scoredLead = run.leads.find(l => l.addressKey === lead.addressKey)
      const nearbyStorms = (run.stormEvents || []).filter(
        s => distanceMiles(lead.latitude, lead.longitude, s.latitude, s.longitude) <= 5
      )
      setProfile(buildPropertyProfile({
        address: lead.address,
        addressKey: lead.addressKey,
        ...(scoredLead?.parcel ? { parcel: scoredLead.parcel } : {}),
        permits: [],
        storms: nearbyStorms,
        now: new Date()
      }))
    }
  }, [lead, run])

  if (loading) return <div className="p-8 text-center bg-white text-black min-h-screen">Loading Evidence Package...</div>
  if (!lead) return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Lead not found</div>

  return (
    <div className="bg-white text-black min-h-screen -mx-4 -mt-4 px-4 pt-4 sm:mx-0 sm:mt-0 sm:px-0 sm:pt-0">
      <style>{\n        @media print {
          @page { size: letter; margin: 1in; }
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        .page-break { page-break-before: always; }
      }</style>
      
      <div className="max-w-4xl mx-auto p-4 sm:p-8 font-sans">
        <div className="flex justify-between items-start mb-8 border-b-2 border-gray-800 pb-4">
          <div>
            <h1 className="text-3xl font-bold uppercase tracking-wide">Factual Evidence Package</h1>
            <p className="text-lg mt-2 font-medium text-gray-700">{lead.address}</p>
            {lead.city && lead.postalCode && <p className="text-base text-gray-600">{lead.city}, LA {lead.postalCode}</p>}
          </div>
          <div className="no-print space-x-2">
            <button onClick={() => navigate(-1)} className="px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-100 transition-colors">Back</button>
            <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors">Print to PDF</button>
          </div>
        </div>
        
        <div className="mb-8">
          <h2 className="text-xl font-bold border-b border-gray-300 mb-4 pb-2">Storm Evidence</h2>
          {profile && profile.storms.length > 0 ? (
            <ul className="space-y-3">
              {profile.storms.map((storm, idx) => (
                <li key={idx} className="bg-gray-50 p-4 rounded border border-gray-200">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-lg">{new Date(storm.occurredAt).toLocaleDateString()}</span>
                    <span className="font-bold text-red-600 bg-red-100 px-3 py-1 rounded">{storm.hailSizeInches}" Hail</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">Recorded within 5 miles of property</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-600 italic">No significant storm events recorded recently.</p>
          )}
        </div>
        
        {(eagleViewCapture || photos.length > 0) && (
          <div className="mb-8 page-break">
            <h2 className="text-xl font-bold border-b border-gray-300 mb-4 pb-2">Photographic Evidence</h2>
            
            {eagleViewCapture && (
              <EagleViewPhoto capture={eagleViewCapture} latitude={lead.latitude} longitude={lead.longitude} />
            )}
            
            {photos.length > 0 && (
              <div className="grid grid-cols-2 gap-6 mt-6">
                {photos.map(p => <EvidencePhoto key={p.id} photo={p} />)}
              </div>
            )}
          </div>
        )}
        
        <div className="mt-12 text-sm text-gray-500 text-center border-t border-gray-200 pt-4">
          Generated on {new Date().toLocaleDateString()} by Delta Ridge Factual Evidence System
        </div>
      </div>
    </div>
  )
}

