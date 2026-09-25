import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { Button, Card, SectionTitle } from '@/components/ui'
import { Nothing } from '@/features/manager/tabs/shared'
import { getSupabase } from '@/lib/supabase'

export default function CampaignsTab() {
  const [isCreating, setIsCreating] = useState(false)
  
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Targeted geographic efforts">
          Active Campaigns
        </SectionTitle>
        {!isCreating && (
          <Button variant="ghost" onClick={() => setIsCreating(true)}>
            + New
          </Button>
        )}
      </div>

      {!isCreating ? (
        <Nothing
          title="No campaigns yet"
          body="Campaign scoping (Spec 16) is wired up. You can create targeted geographic areas and assign leads to them."
        />
      ) : (
        <CreateCampaignForm onCancel={() => setIsCreating(false)} />
      )}
    </div>
  )
}

function CreateCampaignForm({ onCancel }: { onCancel: () => void }) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const draw = useRef<MapboxDraw | null>(null)
  
  const [name, setName] = useState('')
  const [area, setArea] = useState<{ features: { geometry: unknown }[] } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!mapContainer.current) return

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN || ''
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-90.9634, 30.2241], // Default to Baton Rouge area
      zoom: 11
    })

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true
      },
      defaultMode: 'draw_polygon'
    })

    map.current.addControl(draw.current)

    map.current.on('draw.create', updateArea)
    map.current.on('draw.delete', updateArea)
    map.current.on('draw.update', updateArea)

    function updateArea() {
      const data = draw.current?.getAll()
      if (data && data.features.length > 0) {
        setArea(data)
      } else {
        setArea(null)
      }
    }

    return () => {
      map.current?.remove()
    }
  }, [])

  const handleSave = async () => {
    if (!name || !area) return
    setSaving(true)
    
    try {
      const client = getSupabase()
      if (!client) throw new Error('Supabase client not available')

      // Create campaign in Supabase with the drawn MultiPolygon
      const feature = area.features[0] // Assuming single polygon for MVP
      if (!feature) throw new Error('No polygon drawn')
      const { error } = await client.from('campaigns').insert({
        name,
        is_active: true,
        area: feature.geometry // PostGIS will cast this GeoJSON to geography if formatted correctly
      })
      
      if (error) throw error
      onCancel()
    } catch (err) {
      console.error('Failed to save campaign:', err)
      alert('Failed to save campaign. Check console.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="animate-in fade-in slide-in-from-top-2">
      <h3 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">New Campaign Scope</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs text-[var(--color-ink)]/">Campaign Name</label>
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl bg-surface-3 px-4 py-3 text-sm text-[var(--color-ink)] outline-none focus:ring-2 focus:ring-brand-500" 
            placeholder="e.g., Spring Hail Storm - Area 4" 
          />
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-xs text-[var(--color-ink)]/">
            <span>Target Area (Draw Polygon)</span>
            {!area && <span className="font-semibold text-brand-700">Required</span>}
            {area && <span className="font-semibold text-green-700">Area Defined</span>}
          </label>
          <div className="overflow-hidden rounded-xl border border-slate-300">
            <div ref={mapContainer} className="h-64 w-full" />
          </div>
        </div>
        <div className="flex gap-3 pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button 
            className="flex-1" 
            disabled={!name || !area || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Campaign'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
