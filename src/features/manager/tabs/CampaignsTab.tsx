import { useEffect, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { Nothing } from '@/features/manager/tabs/shared'
import { getSupabase } from '@/lib/supabase'
import { currentPosition } from '@/lib/image'
import { circlePolygon, type SearchCenter } from '@/features/leads/search-area'
import EagleViewLeadMap from '@/features/imagery/EagleViewLeadMap'

export default function CampaignsTab() {
  const [isCreating, setIsCreating] = useState(false)

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Targeted geographic efforts">Active Campaigns</SectionTitle>
        {!isCreating && (
          <Button variant="ghost" onClick={() => setIsCreating(true)}>
            + New
          </Button>
        )}
      </div>

      {!isCreating ? (
        <Nothing
          title="No campaigns yet"
          body="Create a campaign around the manager's current GPS location. The in-app map uses EagleView imagery when the production WMTS entitlement is available."
        />
      ) : (
        <CreateCampaignForm onCancel={() => setIsCreating(false)} />
      )}
    </div>
  )
}

function CreateCampaignForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [center, setCenter] = useState<SearchCenter | null>(null)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locate = async () => {
    setLocating(true)
    setError(null)
    const pos = await currentPosition(8000)
    setLocating(false)
    if (!pos) {
      setError('Current location is required. Turn on Location Services, then try again.')
      return
    }
    setCenter({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
      ...(Number.isFinite(pos.coords.accuracy)
        ? { accuracyMeters: Math.round(pos.coords.accuracy) }
        : {}),
    })
  }

  useEffect(() => {
    void locate()
  }, [])

  const handleSave = async () => {
    if (!name.trim() || !center) return
    setSaving(true)
    setError(null)

    try {
      const client = getSupabase()
      if (!client) throw new Error('Supabase client not available')

      const { data: auth, error: authError } = await client.auth.getUser()
      if (authError || !auth.user) throw new Error('Sign in before creating a campaign.')

      const { data: membership, error: membershipError } = await client
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', auth.user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (membershipError || !membership?.organization_id) {
        throw new Error('No active organization membership was found.')
      }

      const polygon = circlePolygon(center, radiusMiles, 96)
      const area = {
        type: 'MultiPolygon',
        coordinates: [polygon.geometry.coordinates],
      }

      const { error: insertError } = await client.from('campaigns').insert({
        organization_id: membership.organization_id,
        name: name.trim(),
        description:
          'GPS-centered campaign · ' +
          radiusMiles.toFixed(1) +
          ' mi radius · created ' +
          new Date().toISOString(),
        is_active: true,
        area,
        created_by: auth.user.id,
      })

      if (insertError) throw insertError
      onCancel()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save campaign.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="animate-in fade-in slide-in-from-top-2">
      <h3 className="mb-4 text-sm font-semibold text-text-primary">New Campaign Scope</h3>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Campaign Name</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl bg-bg-app-3 px-4 py-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand-primary"
            placeholder="e.g., May 8 hail follow-up"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-text-secondary">Radius from current location</label>
          <select
            value={String(radiusMiles)}
            onChange={(event) => setRadiusMiles(Number(event.target.value))}
            className="w-full rounded-xl bg-bg-app-3 px-4 py-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-brand-primary"
          >
            <option value="1">1 mile</option>
            <option value="2">2 miles</option>
            <option value="3">3 miles</option>
            <option value="5">5 miles</option>
            <option value="10">10 miles</option>
            <option value="15">15 miles</option>
            <option value="25">25 miles</option>
          </select>
        </div>

        <div className="rounded-xl bg-route-surface px-3 py-2 ring-1 ring-route-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-route-live">
                Campaign center
              </p>
              <p className="mt-0.5 text-[11.5px] text-text-secondary">
                {center
                  ? 'Using current GPS location' +
                    (center.accuracyMeters ? ' · ±' + center.accuracyMeters + ' m' : '')
                  : locating
                    ? 'Locating…'
                    : 'Location unavailable'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void locate()} disabled={locating}>
              Refresh
            </Button>
          </div>
        </div>

        {center && (
          <EagleViewLeadMap
            doors={[]}
            leads={[]}
            storms={[]}
            searchCenter={center}
            searchRadiusMiles={radiusMiles}
            onOpenLead={() => undefined}
          />
        )}

        {error && (
          <div className="rounded-xl bg-warning-surface px-3 py-2 ring-1 ring-warning-border">
            <p className="text-[11.5px] leading-relaxed text-status-warning">{error}</p>
          </div>
        )}

        <p className="text-[10.5px] leading-relaxed text-text-muted">
          Delta Ridge no longer uses Mapbox to draw campaign territory. This version creates a precise
          geodesic radius around the device GPS fix and previews EagleView ortho imagery when that
          production entitlement is configured.
        </p>

        <div className="flex gap-3 pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!name.trim() || !center || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save Campaign'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
