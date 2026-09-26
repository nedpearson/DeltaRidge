import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { mapboxToken } from '@/features/leads/basemap'
import { acquireSearchCenter } from '@/features/leads/location-search'
import { getSupabase } from '@/lib/supabase'

interface CampaignRow {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

export default function CampaignsTab({
  organizationId,
  userId,
}: {
  organizationId: string | null
  userId: string | null
}) {
  const [isCreating, setIsCreating] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organizationId) {
      setCampaigns([])
      setLoading(false)
      return
    }
    const client = getSupabase()
    if (!client) {
      setError('Server connection is unavailable.')
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: readError } = await client
      .from('campaigns')
      .select('id, name, is_active, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (readError) {
      setError(readError.message)
      setCampaigns([])
    } else {
      setError(null)
      setCampaigns(
        ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: row['id'] as string,
          name: row['name'] as string,
          isActive: row['is_active'] === true,
          createdAt: row['created_at'] as string,
        })),
      )
    }
    setLoading(false)
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Organization-scoped geographic campaigns">
          CAMPAIGNS
        </SectionTitle>
        {!isCreating && (
          <Button variant="secondary" onClick={() => setIsCreating(true)}>
            New campaign
          </Button>
        )}
      </div>

      {error && (
        <Card className="!py-3">
          <p className="text-[12px] text-status-critical">{error}</p>
        </Card>
      )}

      {isCreating ? (
        <CreateCampaignForm
          organizationId={organizationId}
          userId={userId}
          onCancel={() => setIsCreating(false)}
          onSaved={async () => {
            setIsCreating(false)
            await load()
          }}
        />
      ) : loading ? (
        <Card className="!py-3">
          <p className="text-[12.5px] text-text-secondary">Loading campaigns…</p>
        </Card>
      ) : campaigns.length === 0 ? (
        <Empty
          title="No campaigns yet"
          body="Create a territory around a storm or neighborhood, then use that scope for targeted lead work."
        />
      ) : (
        <div className="space-y-2">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="!py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-text-primary">
                    {campaign.name}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-text-secondary">
                    Created {new Date(campaign.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={
                    campaign.isActive
                      ? 'rounded-full bg-status-success/10 px-2 py-1 text-[10px] text-status-success ring-1 ring-status-success/20'
                      : 'rounded-full bg-bg-elevated px-2 py-1 text-[10px] text-text-secondary ring-1 ring-border-subtle'
                  }
                >
                  {campaign.isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateCampaignForm({
  organizationId,
  userId,
  onCancel,
  onSaved,
}: {
  organizationId: string | null
  userId: string | null
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const draw = useRef<MapboxDraw | null>(null)

  const [name, setName] = useState('')
  const [geometry, setGeometry] = useState<unknown | null>(null)
  const [saving, setSaving] = useState(false)
  const [locationMessage, setLocationMessage] = useState('Getting your location…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mapContainer.current) return
    const token = mapboxToken()
    if (!token) {
      setError('Mapbox is not configured, so a campaign area cannot be drawn.')
      return
    }

    let active = true
    let instance: mapboxgl.Map | null = null

    void acquireSearchCenter().then((location) => {
      if (!active || !mapContainer.current) return

      const center: [number, number] =
        location.kind === 'ready'
          ? [location.center.longitude, location.center.latitude]
          : [-91.1871, 30.4515]

      setLocationMessage(
        location.kind === 'ready'
          ? 'Map centered on your current location.'
          : 'Current location unavailable. The map opened at the service area; pan to the campaign area before drawing.',
      )

      mapboxgl.accessToken = token
      instance = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center,
        zoom: location.kind === 'ready' ? 13 : 10,
      })
      map.current = instance

      draw.current = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'draw_polygon',
      })
      instance.addControl(draw.current)

      const updateArea = () => {
        const feature = draw.current?.getAll().features[0]
        setGeometry(feature?.geometry ?? null)
      }

      instance.on('draw.create', updateArea)
      instance.on('draw.delete', updateArea)
      instance.on('draw.update', updateArea)
    })

    return () => {
      active = false
      instance?.remove()
      map.current = null
      draw.current = null
    }
  }, [])

  const handleSave = async () => {
    if (!name.trim() || !geometry || !organizationId || !userId) return
    const client = getSupabase()
    if (!client) {
      setError('Server connection is unavailable.')
      return
    }

    setSaving(true)
    setError(null)
    // PostGIS geography is created through the database RPC rather than asking
    // PostgREST to guess how a browser GeoJSON object should be cast. The RPC
    // also enforces the manager/admin role and geometry validity at the DB
    // boundary.
    const { error: writeError } = await client.rpc('create_campaign', {
      p_organization_id: organizationId,
      p_name: name.trim(),
      p_geometry: geometry,
    })

    if (writeError) {
      setError(writeError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    await onSaved()
  }

  return (
    <Card>
      <h3 className="text-[14px] font-semibold text-text-primary">New campaign territory</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
        Draw only the area you intend to work. Campaigns are private to this organization.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-text-secondary">
            Campaign name
          </label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-bg-app px-3 py-3 text-[13px] text-text-primary outline-none focus:border-brand-primary"
            placeholder="May hail — Oak Hills"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <label className="text-[11px] uppercase tracking-wider text-text-secondary">
              Target area
            </label>
            <span className={geometry ? 'text-[10.5px] text-status-success' : 'text-[10.5px] text-status-warning'}>
              {geometry ? 'Area defined' : 'Draw a polygon'}
            </span>
          </div>
          <p className="mb-2 text-[10.5px] text-text-secondary">{locationMessage}</p>
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            <div ref={mapContainer} className="h-72 w-full bg-bg-elevated" />
          </div>
        </div>

        {error && (
          <p className="rounded-xl bg-status-critical/10 px-3 py-2 text-[11.5px] text-status-critical ring-1 ring-status-critical/20">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!name.trim() || !geometry || !organizationId || !userId || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save campaign'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
