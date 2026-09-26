import { useCallback, useEffect, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { Nothing, ago } from '@/features/manager/tabs/shared'
import { getSupabase } from '@/lib/supabase'
import { pendingWork } from '@/lib/sync'
import { readCachedRun } from '@/features/leads/engine'
import { hasBasemap } from '@/features/leads/basemap'
import { assessHealth, needsAttention, worstFirst, type Health, type HealthState } from './health'

/**
 * Settings → Integrations → Health.
 *
 * Every row here is computed from traffic this organisation actually put
 * through the integration. Nothing on this screen turns green because a
 * credential exists, which is the usual way a health dashboard comes to be
 * confidently wrong.
 *
 * Integrations Delta Ridge has not built yet are listed as not set up rather
 * than omitted, because "where is EagleView?" is a better question for a
 * manager to be able to ask than to have the row quietly missing.
 */

const TONE: Record<HealthState, { dot: string; word: string }> = {
  down: { dot: 'bg-status-critical', word: 'Down' },
  degraded: { dot: 'bg-status-warning', word: 'Unreliable' },
  stale: { dot: 'bg-status-warning', word: 'Gone quiet' },
  never_used: { dot: 'bg-bg-elevated', word: 'Unproven' },
  healthy: { dot: 'bg-status-success', word: 'Working' },
  not_configured: { dot: 'bg-bg-elevated', word: 'Not set up' },
}

interface Row {
  readonly key: string
  readonly label: string
  readonly detail: string
  readonly health: Health
}

export default function HealthTab({ organizationId }: { organizationId: string | null }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = getSupabase()
    const now = Date.now()
    const built: Row[] = []

    // --- Sync: the one integration that always exists, measured on the device.
    const [work, lastRun] = await Promise.all([pendingWork(), readCachedRun()])
    built.push({
      key: 'sync',
      label: 'Field sync',
      detail: 'This device to the server',
      health: assessHealth(
        {
          configured: true,
          // Anything that gave up is a failure; anything still queued is not
          // yet either, so it is counted as neither.
          successes: Math.max(0, work.total - work.stalled),
          failures: work.stalled,
          lastSuccessAt: null,
          lastFailureAt: null,
          expectedWithinHours: null,
        },
        now,
      ),
    })

    if (lastRun) {
      const official = lastRun.coverage.official
      built.push({
        key: 'nws',
        label: 'NWS ground hail',
        detail: 'Official Local Storm Reports used by the lead engine',
        health: assessHealth(
          {
            configured: true,
            successes: official.kind === 'live' ? 1 : 0,
            failures: official.kind === 'failed' ? 1 : 0,
            lastSuccessAt: official.kind === 'live' ? lastRun.ranAt : null,
            lastFailureAt: official.kind === 'failed' ? lastRun.ranAt : null,
            expectedWithinHours: 24,
          },
          now,
        ),
      })

      const radar = lastRun.coverage.radar
      built.push({
        key: 'radar',
        label: 'NEXRAD radar hail',
        detail: 'Radar-estimated hail used alongside ground reports',
        health: assessHealth(
          {
            configured: radar.kind !== 'not_configured',
            successes: radar.kind === 'live' ? 1 : 0,
            failures: radar.kind === 'failed' ? 1 : 0,
            lastSuccessAt: radar.kind === 'live' ? lastRun.ranAt : null,
            lastFailureAt: radar.kind === 'failed' ? lastRun.ranAt : null,
            expectedWithinHours: 24,
          },
          now,
        ),
      })
    }

    built.push({
      key: 'mapbox',
      label: 'Mapbox',
      detail:
        'Interactive street/satellite map. A configured token is not counted as proof of a successful tile request.',
      health: assessHealth(
        {
          configured: hasBasemap(),
          successes: 0,
          failures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          expectedWithinHours: null,
        },
        now,
      ),
    })

    if (supabase !== null) {
      const { data: mrms } = await supabase
        .from('mrms_health')
        .select('latest_success_at, latest_failure_at, successful_runs, failed_runs, coverage_started_at')
        .eq('product', 'MESH_Max_30min')
        .maybeSingle()

      const mrmsRow = (mrms ?? null) as Record<string, unknown> | null
      built.push({
        key: 'mrms',
        label: 'NOAA MRMS MESH',
        detail:
          'Server-decoded MESH Max 30-minute GRIB2. Radar-estimated hail only; not a ground report.',
        health: assessHealth(
          {
            configured: mrmsRow !== null,
            successes: Number(mrmsRow?.['successful_runs'] ?? 0),
            failures: Number(mrmsRow?.['failed_runs'] ?? 0),
            lastSuccessAt: (mrmsRow?.['latest_success_at'] as string | null | undefined) ?? null,
            lastFailureAt: (mrmsRow?.['latest_failure_at'] as string | null | undefined) ?? null,
            expectedWithinHours: 0.5,
          },
          now,
        ),
      })
    } else {
      built.push({
        key: 'mrms',
        label: 'NOAA MRMS MESH',
        detail: 'Server connection unavailable; MRMS ingest health cannot be read.',
        health: assessHealth(
          {
            configured: false,
            successes: 0,
            failures: 0,
            lastSuccessAt: null,
            lastFailureAt: null,
            expectedWithinHours: null,
          },
          now,
        ),
      })
    }

    if (supabase !== null && organizationId !== null) {
      const [settings, events, outbox, imagery, contactSettings, contactEvents, propertyEvents, acquisitionSettings] = await Promise.all([
        supabase
          .from('roofr_settings')
          .select('webhook_secret_hash, push_enabled, last_inbound_at, last_outbound_at')
          .eq('organization_id', organizationId)
          .maybeSingle(),
        supabase
          .from('roofr_events')
          .select('status, received_at')
          .eq('organization_id', organizationId)
          .order('received_at', { ascending: false })
          .limit(200),
        supabase
          .from('roofr_outbox')
          .select('status, created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('imagery_requests')
          .select('status, requested_at, completed_at')
          .eq('organization_id', organizationId)
          .eq('provider', 'eagleview')
          .order('requested_at', { ascending: false })
          .limit(200),
        supabase
          .from('contact_provider_settings')
          .select('entitlement, credential_present, commercial_use_confirmed')
          .eq('organization_id', organizationId)
          .maybeSingle(),
        supabase
          .from('contact_lookup_events')
          .select('status, requested_at, completed_at')
          .eq('organization_id', organizationId)
          .order('requested_at', { ascending: false })
          .limit(200),
        supabase
          .from('property_lookup_events')
          .select('status, requested_at, completed_at')
          .eq('organization_id', organizationId)
          .order('requested_at', { ascending: false })
          .limit(200),
        supabase
          .from('acquisition_webhook_settings')
          .select('enabled, webhook_secret_hash, last_received_at')
          .eq('organization_id', organizationId)
          .maybeSingle(),
      ])

      const s = (settings.data ?? null) as Record<string, unknown> | null
      const inboundRows = ((events.data ?? []) as unknown[]).map((r) => r as Record<string, unknown>)
      const outboundRows = ((outbox.data ?? []) as unknown[]).map((r) => r as Record<string, unknown>)
      const imageryRows = ((imagery.data ?? []) as unknown[]).map((r) => r as Record<string, unknown>)
      const contactConfig = (contactSettings.data ?? null) as Record<string, unknown> | null
      const contactRows = ((contactEvents.data ?? []) as unknown[]).map((r) => r as Record<string, unknown>)
      const propertyRows = ((propertyEvents.data ?? []) as unknown[]).map((r) => r as Record<string, unknown>)
      const acquisitionConfig = (acquisitionSettings.data ?? null) as Record<string, unknown> | null

      built.push({
        key: 'roofr_in',
        label: 'Roofr → Delta Ridge',
        detail: 'Events arriving through Zapier',
        health: assessHealth(
          {
            configured: s?.['webhook_secret_hash'] != null,
            successes: inboundRows.filter((r) => r['status'] === 'processed' || r['status'] === 'ignored').length,
            failures: inboundRows.filter((r) => r['status'] === 'failed').length,
            lastSuccessAt: (s?.['last_inbound_at'] as string | null) ?? null,
            lastFailureAt: null,
            // Event-driven: a quiet week just means nobody sent a proposal.
            expectedWithinHours: null,
          },
          now,
        ),
      })

      built.push({
        key: 'roofr_out',
        label: 'Delta Ridge → Roofr',
        detail: 'Creating jobs through Zapier',
        health: assessHealth(
          {
            configured: s?.['push_enabled'] === true,
            // Acknowledged, not sent. Zapier accepting a POST is not Roofr
            // making a job, and counting it as success would make this row
            // green while jobs quietly failed to appear.
            successes: outboundRows.filter((r) => r['status'] === 'acknowledged').length,
            failures: outboundRows.filter((r) => r['status'] === 'failed' || r['status'] === 'given_up').length,
            lastSuccessAt: (s?.['last_outbound_at'] as string | null) ?? null,
            lastFailureAt: null,
            expectedWithinHours: null,
          },
          now,
        ),
      })

      const imagerySuccess = imageryRows.filter((r) => r['status'] === 'succeeded')
      const imageryFailure = imageryRows.filter((r) => r['status'] === 'failed')
      built.push({
        key: 'eagleview',
        label: 'EagleView',
        detail: 'Imagery API discovery and full-resolution images',
        health: assessHealth(
          {
            // A server secret cannot be read by this screen. The first request
            // records not_configured or actual traffic, so health stays honest.
            configured: imageryRows.some((r) => r['status'] !== 'not_configured'),
            successes: imagerySuccess.length,
            failures: imageryFailure.length,
            lastSuccessAt: (imagerySuccess[0]?.['completed_at'] as string | null) ?? null,
            lastFailureAt: (imageryFailure[0]?.['completed_at'] as string | null) ?? null,
            expectedWithinHours: null,
          },
          now,
        ),
      })

      const contactSuccess = contactRows.filter((r) => r['status'] === 'succeeded' || r['status'] === 'not_found')
      const contactFailure = contactRows.filter((r) => r['status'] === 'failed')
      const contactConfigured =
        contactConfig?.['entitlement'] === 'business_api' &&
        contactConfig?.['credential_present'] === true &&
        contactConfig?.['commercial_use_confirmed'] === true

      built.push({
        key: 'contacts',
        label: 'Contact enrichment',
        detail: 'Commercial provider lookups; returned phone/email values are not written to the health log',
        health: assessHealth(
          {
            configured: contactConfigured,
            successes: contactSuccess.length,
            failures: contactFailure.length,
            lastSuccessAt: (contactSuccess[0]?.['completed_at'] as string | null) ?? null,
            lastFailureAt: (contactFailure[0]?.['completed_at'] as string | null) ?? null,
            expectedWithinHours: null,
          },
          now,
        ),
      })

      const propertySuccess = propertyRows.filter(
        (r) => r['status'] === 'succeeded' || r['status'] === 'not_found',
      )
      const propertyFailure = propertyRows.filter((r) => r['status'] === 'failed')
      const propertyConfigured = propertyRows.some((r) => r['status'] !== 'not_configured')

      built.push({
        key: 'property-data',
        label: 'Property enrichment',
        detail: 'Commercial property-data API; health log stores provider/status only',
        health: assessHealth(
          {
            configured: propertyConfigured,
            successes: propertySuccess.length,
            failures: propertyFailure.length,
            lastSuccessAt: (propertySuccess[0]?.['completed_at'] as string | null) ?? null,
            lastFailureAt: (propertyFailure[0]?.['completed_at'] as string | null) ?? null,
            expectedWithinHours: null,
          },
          now,
        ),
      })

      built.push({
        key: 'acquisition',
        label: 'Inbound lead API',
        detail: 'Signed Google/Meta/Zapier/partner lead ingestion and attribution endpoint',
        health: assessHealth(
          {
            configured:
              acquisitionConfig?.['enabled'] === true &&
              acquisitionConfig?.['webhook_secret_hash'] != null,
            successes: acquisitionConfig?.['last_received_at'] ? 1 : 0,
            failures: 0,
            lastSuccessAt:
              (acquisitionConfig?.['last_received_at'] as string | null | undefined) ?? null,
            lastFailureAt: null,
            expectedWithinHours: null,
          },
          now,
        ),
      })
    }

    setRows(worstFirst(built))
    setLoading(false)
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const attention = needsAttention(rows)

  return (
    <Card>
      <SectionTitle hint="Every row is computed from traffic that actually went through. Nothing here turns green because a credential exists.">
        INTEGRATION HEALTH
      </SectionTitle>

      {loading ? (
        <p className="mt-3 text-[12.5px] text-text-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <Nothing title="Nothing to report" body="No integrations are configured yet." />
      ) : (
        <>
          <p className={`mt-2 text-[12.5px] ${attention > 0 ? 'text-status-warning' : 'text-text-secondary'}`}>
            {attention > 0
              ? `${attention} need${attention === 1 ? 's' : ''} a look`
              : 'Nothing needs attention'}
          </p>

          <ul className="mt-3 space-y-2.5">
            {rows.map((row) => {
              const tone = TONE[row.health.state]
              return (
                <li key={row.key} className="flex gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 break-words text-[13px] text-text-secondary">{row.label}</span>
                      {/* Spelled out, not left to the colour — the screen gets
                          read in sunlight, and by people who cannot tell amber
                          from green. */}
                      <span className="shrink-0 text-[11px] text-text-secondary">{tone.word}</span>
                    </div>
                    <p className="text-[11.5px] text-text-secondary">{row.health.summary}</p>
                    <p className="text-[11px] text-text-secondary">{row.detail}</p>
                    {row.health.lastSuccessAt !== null && (
                      <p className="text-[11px] text-text-secondary">
                        Last success {ago(row.health.lastSuccessAt)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}
