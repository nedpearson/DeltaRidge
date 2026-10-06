import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, User } from 'lucide-react'
import { Card, Field, SectionTitle, TextInput } from '@/components/ui'
import AccountPanel from '@/features/auth/AccountPanel'
import { useSession } from '@/features/auth/session'
import {
  readProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from '@/features/contacts/store'
import type { EnrichmentEntitlement } from '@/features/contacts/enrichment'
import IntegrationHealthPanel from '@/features/integrations/health/IntegrationHealthPanel'
import { getSupabase } from '@/lib/supabase'

type TabType =
  | 'account'
  | 'org'
  | 'team'
  | 'leads'
  | 'storms'
  | 'field'
  | 'contacts'
  | 'comms'
  | 'ai'
  | 'integrations'
  | 'notifications'
  | 'insurance'
  | 'privacy'
  | 'security'
  | 'compliance'
  | 'health'

type JsonObject = Record<string, unknown>

interface TeamMember {
  id: string
  userId: string
  role: string
  isActive: boolean
  name: string
  phone: string | null
}

const TABS: Array<{ id: TabType; label: string }> = [
  { id: 'account', label: 'My Account' },
  { id: 'org', label: 'Organization' },
  { id: 'team', label: 'Team & Roles' },
  { id: 'leads', label: 'Leads & Sales' },
  { id: 'storms', label: 'Storms' },
  { id: 'field', label: 'Field & GPS' },
  { id: 'contacts', label: 'Contact Enrichment' },
  { id: 'comms', label: 'Communications' },
  { id: 'ai', label: 'AI & Automation' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'insurance', label: 'Insurance Workflow' },
  { id: 'privacy', label: 'Data & Privacy' },
  { id: 'security', label: 'Security' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'health', label: 'System Health' },
]

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  salesperson: 'Field Representative',
  office: 'Office',
  inspector: 'Inspector',
}

const DEFAULT_SETTINGS = {
  storm_settings: {
    wind_threshold: 60,
    hail_threshold: 1,
    enable_wind: true,
    lookback_months: 24,
    minimum_confidence: 0.65,
  },
  gps_settings: {
    enable_tracking: true,
    property_geofence_radius: 100,
    default_search_radius_miles: 10,
    high_accuracy: true,
    allow_ip_fallback: true,
    stale_after_seconds: 120,
  },
  ai_settings: {
    autonomy_level: 'assisted',
    enable_sms: false,
    enable_voice: false,
    confidence_threshold: 0.8,
    human_handoff_threshold: 0.6,
  },
  leads_settings: {
    assignment_mode: 'manual',
    stale_lead_days: 14,
    response_sla_minutes: 15,
    appointment_minutes: 60,
    max_rep_workload: 50,
  },
  communications_settings: {
    enable_sms: false,
    enable_email: true,
    enable_voice: false,
    business_hours_only: true,
    business_hours_start: '08:00',
    business_hours_end: '19:00',
  },
  notifications_settings: {
    notify_on_new_lead: true,
    notify_on_storm: true,
    notify_on_failed_job: true,
    notify_on_customer_reply: true,
    notify_on_assignment: true,
    notify_on_gps_stale: true,
  },
  insurance_settings: {
    allow_document_upload: true,
    require_human_review: true,
    require_homeowner_confirmation: true,
  },
  privacy_settings: {
    retention_days: 365,
    gps_retention_days: 90,
    communications_retention_days: 365,
    ai_transcript_retention_days: 180,
  },
  security_settings: {
    require_mfa: false,
    session_timeout_minutes: 120,
    require_admin_for_integrations: true,
  },
}

function asObject(value: unknown, fallback: JsonObject): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : fallback
}

function valueString(object: JsonObject | undefined, key: string, fallback = ''): string {
  if (!object) return fallback
  const value = object[key]
  return typeof value === 'string' ? value : fallback
}

function valueNumber(object: JsonObject | undefined, key: string, fallback = 0): number {
  if (!object) return fallback
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function valueBool(object: JsonObject | undefined, key: string, fallback = false): boolean {
  if (!object) return fallback
  const value = object[key]
  return typeof value === 'boolean' ? value : fallback
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-elevated/40 p-3">
      <input
        type="checkbox"
        className="mt-0.5 rounded border-border-light text-brand-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-text-secondary">{hint}</span>}
      </span>
    </label>
  )
}

function SaveBar({
  saving,
  saved,
  error,
  disabled,
  onSave,
}: {
  saving: boolean
  saved: boolean
  error: string | null
  disabled: boolean
  onSave: () => void
}) {
  return (
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle bg-bg-card/95 p-3 backdrop-blur">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {saved && <span className="text-xs text-status-success">Saved and persisted.</span>}
      {error && <span className="text-xs text-status-critical">{error}</span>}
      {disabled && <span className="text-xs text-text-secondary">Administrator or manager access required.</span>}
    </div>
  )
}

export default function SettingsPage() {
  const { session, membership, membershipError, profile, updateProfile } = useSession()
  const [activeTab, setActiveTab] = useState<TabType>('account')
  const [settings, setSettings] = useState<Record<string, JsonObject>>(DEFAULT_SETTINGS)
  const [orgName, setOrgName] = useState('')
  const [orgTimezone, setOrgTimezone] = useState('America/Chicago')
  const [localName, setLocalName] = useState('')
  const [localPhone, setLocalPhone] = useState('')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [contactSettings, setContactSettings] = useState<ProviderSettings | null>(null)
  const [contactBasis, setContactBasis] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canManage = membership?.role === 'admin' || membership?.role === 'manager'
  const orgId = membership?.organizationId ?? null

  useEffect(() => {
    setLocalName(profile?.fullName ?? '')
    setLocalPhone(profile?.phone ?? '')
  }, [profile?.fullName, profile?.phone])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (!session || !orgId) {
      setLoading(false)
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      setError('No connection to the server.')
      setLoading(false)
      return
    }

    const [orgResult, settingsResult, membersResult, contacts] = await Promise.all([
      supabase.from('organizations').select('name, timezone').eq('id', orgId).maybeSingle(),
      supabase.from('organization_settings').select('*').eq('organization_id', orgId).maybeSingle(),
      supabase
        .from('organization_members')
        .select('id, user_id, role, is_active')
        .eq('organization_id', orgId)
        .order('created_at'),
      readProviderSettings(orgId),
    ])

    if (orgResult.error) setError(orgResult.error.message)
    if (settingsResult.error) setError(settingsResult.error.message)
    if (membersResult.error) setError(membersResult.error.message)

    if (orgResult.data) {
      setOrgName(orgResult.data.name ?? '')
      setOrgTimezone(orgResult.data.timezone ?? 'America/Chicago')
    }

    if (settingsResult.data) {
      const row = settingsResult.data as Record<string, unknown>
      setSettings({
        storm_settings: asObject(row['storm_settings'], DEFAULT_SETTINGS.storm_settings),
        gps_settings: asObject(row['gps_settings'], DEFAULT_SETTINGS.gps_settings),
        ai_settings: asObject(row['ai_settings'], DEFAULT_SETTINGS.ai_settings),
        leads_settings: asObject(row['leads_settings'], DEFAULT_SETTINGS.leads_settings),
        communications_settings: asObject(
          row['communications_settings'],
          DEFAULT_SETTINGS.communications_settings,
        ),
        notifications_settings: asObject(
          row['notifications_settings'],
          DEFAULT_SETTINGS.notifications_settings,
        ),
        insurance_settings: asObject(
          row['insurance_settings'],
          DEFAULT_SETTINGS.insurance_settings,
        ),
        privacy_settings: asObject(row['privacy_settings'], DEFAULT_SETTINGS.privacy_settings),
        security_settings: asObject(row['security_settings'], DEFAULT_SETTINGS.security_settings),
      })
    }

    const memberRows = (membersResult.data ?? []) as Array<{
      id: string
      user_id: string
      role: string
      is_active: boolean
    }>
    if (memberRows.length > 0) {
      const ids = memberRows.map((member) => member.user_id)
      const profilesResult = await supabase
        .from('profiles')
        .select('id, full_name, display_name, first_name, last_name, phone, mobile_phone')
        .in('id', ids)
      const profileMap = new Map<string, Record<string, unknown>>()
      for (const raw of (profilesResult.data ?? []) as unknown[]) {
        const row = raw as Record<string, unknown>
        profileMap.set(String(row['id']), row)
      }
      setTeam(
        memberRows.map((member) => {
          const person = profileMap.get(member.user_id)
          const first = typeof person?.['first_name'] === 'string' ? person['first_name'] : ''
          const last = typeof person?.['last_name'] === 'string' ? person['last_name'] : ''
          const display =
            (typeof person?.['display_name'] === 'string' && person['display_name']) ||
            (typeof person?.['full_name'] === 'string' && person['full_name']) ||
            [first, last].filter(Boolean).join(' ') ||
            'Unnamed user'
          const phone =
            (typeof person?.['mobile_phone'] === 'string' && person['mobile_phone']) ||
            (typeof person?.['phone'] === 'string' && person['phone']) ||
            null
          return {
            id: member.id,
            userId: member.user_id,
            role: member.role,
            isActive: member.is_active,
            name: String(display),
            phone: phone ? String(phone) : null,
          }
        }),
      )
    } else {
      setTeam([])
    }

    setContactSettings(contacts)
    setContactBasis(contacts.basis ?? '')
    setLoading(false)
  }, [orgId, session])

  useEffect(() => {
    void load()
  }, [load])

  const patchSetting = (section: string, patch: JsonObject) => {
    setSaved(false)
    setSettings((current) => ({
      ...current,
      [section]: { ...(current[section] ?? {}), ...patch },
    }))
  }

  const saveSettings = async () => {
    if (!orgId || !canManage) return
    const supabase = getSupabase()
    if (!supabase) {
      setError('No connection to the server.')
      return
    }
    setSaving(true)
    setSaved(false)
    setError(null)
    const { error: saveError } = await supabase.from('organization_settings').upsert(
      {
        organization_id: orgId,
        storm_settings: settings['storm_settings'],
        gps_settings: settings['gps_settings'],
        ai_settings: settings['ai_settings'],
        leads_settings: settings['leads_settings'],
        communications_settings: settings['communications_settings'],
        notifications_settings: settings['notifications_settings'],
        insurance_settings: settings['insurance_settings'],
        privacy_settings: settings['privacy_settings'],
        security_settings: settings['security_settings'],
      },
      { onConflict: 'organization_id' },
    )
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSaved(true)
  }

  const saveOrganization = async () => {
    if (!orgId || membership?.role !== 'admin') return
    const supabase = getSupabase()
    if (!supabase) return
    setSaving(true)
    setSaved(false)
    setError(null)
    const { error: saveError } = await supabase
      .from('organizations')
      .update({ name: orgName.trim(), timezone: orgTimezone })
      .eq('id', orgId)
    setSaving(false)
    if (saveError) setError(saveError.message)
    else setSaved(true)
  }

  const saveProfile = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      await updateProfile({
        fullName: localName.trim() || null,
        phone: localPhone.trim() || null,
      })
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  const updateMember = async (memberId: string, patch: { role?: string; is_active?: boolean }) => {
    if (!canManage) return
    const supabase = getSupabase()
    if (!supabase) return
    setError(null)
    const { error: updateError } = await supabase
      .from('organization_members')
      .update(patch)
      .eq('id', memberId)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await load()
  }

  const saveContactConfiguration = async () => {
    if (!orgId || !session || !contactSettings || !canManage) return
    setSaving(true)
    setSaved(false)
    setError(null)
    const result = await saveProviderSettings(orgId, session.user.id, {
      entitlement: contactSettings.entitlement,
      credentialPresent: contactSettings.credentialPresent,
      secondaryProvidersEnabled: contactSettings.secondaryProvidersEnabled,
      confirmCommercialUse: contactSettings.commercialUseConfirmed
        ? { basis: contactBasis }
        : false,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    setContactSettings(await readProviderSettings(orgId))
  }

  const activeLabel = useMemo(
    () => TABS.find((tab) => tab.id === activeTab)?.label ?? 'Settings',
    [activeTab],
  )

  if (!session) {
    return (
      <div className="mx-auto mt-12 max-w-md space-y-6">
        <h2 className="text-center text-xl font-bold">Settings</h2>
        <Card className="p-6">
          <p className="mb-4 text-center text-sm text-text-secondary">
            You must be signed in to manage your account.
          </p>
          <AccountPanel />
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Delta Ridge control plane — saved settings drive production behavior.
          </p>
        </div>
        {loading && <span className="text-xs text-text-secondary">Loading current configuration…</span>}
      </div>

      {membershipError && (
        <Card className="mb-5 bg-warning-surface p-4 ring-1 ring-warning-border">
          <p className="text-sm text-status-warning">Organization access error: {membershipError}</p>
        </Card>
      )}

      <div className="flex flex-col gap-8 md:flex-row">
        <nav className="flex w-full shrink-0 gap-1 overflow-x-auto pb-2 md:w-64 md:flex-col" aria-label="Settings sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id)
                setSaved(false)
                setError(null)
              }}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 space-y-5">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
            <SectionTitle>{activeLabel.toUpperCase()}</SectionTitle>
            {orgId && <span className="text-[11px] text-text-muted">Organization-scoped</span>}
          </div>

          {activeTab === 'account' && (
            <>
              <Card className="space-y-4 p-5">
                <div className="flex items-center gap-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-brand-primary/20 text-brand-primary">
                    <User size={32} />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{profile?.fullName || session.user.email}</p>
                    <p className="text-sm text-text-secondary">{session.user.email}</p>
                    <p className="text-sm font-medium text-brand-primary">
                      {membership ? ROLE_LABEL[membership.role] ?? membership.role : 'No organization access'}
                    </p>
                  </div>
                </div>
                <Field label="Full Name">
                  <TextInput value={localName} onChange={(event) => setLocalName(event.target.value)} />
                </Field>
                <Field label="Phone Number">
                  <TextInput
                    value={localPhone}
                    inputMode="tel"
                    onChange={(event) => setLocalPhone(event.target.value)}
                  />
                </Field>
              </Card>
              <Card className="p-5">
                <SectionTitle>AUTHENTICATION</SectionTitle>
                <div className="mt-4">
                  <AccountPanel />
                </div>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={false} onSave={() => void saveProfile()} />
            </>
          )}

          {activeTab === 'org' && (
            <>
              <Card className="space-y-4 p-5">
                <div className="flex items-center gap-3">
                  <Building2 className="text-brand-primary" size={24} />
                  <div>
                    <h3 className="font-bold text-text-primary">{membership?.organizationName || 'Organization'}</h3>
                    <p className="text-xs text-text-secondary">Canonical company identity used across the app.</p>
                  </div>
                </div>
                <Field label="Company Name">
                  <TextInput value={orgName} disabled={membership?.role !== 'admin'} onChange={(event) => setOrgName(event.target.value)} />
                </Field>
                <Field label="Timezone">
                  <select
                    value={orgTimezone}
                    disabled={membership?.role !== 'admin'}
                    onChange={(event) => setOrgTimezone(event.target.value)}
                    className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-sm"
                  >
                    <option value="America/Chicago">America/Chicago</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="America/Denver">America/Denver</option>
                    <option value="America/Los_Angeles">America/Los_Angeles</option>
                  </select>
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={membership?.role !== 'admin'} onSave={() => void saveOrganization()} />
            </>
          )}

          {activeTab === 'team' && (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border-subtle p-5">
                <h3 className="font-bold">Users, roles, and activation</h3>
                <p className="mt-1 text-xs text-text-secondary">Changes are enforced by organization membership and RLS, not only by navigation.</p>
              </div>
              <div className="divide-y divide-border-subtle">
                {team.length === 0 ? (
                  <p className="p-5 text-sm text-text-secondary">No active organization members were returned.</p>
                ) : (
                  team.map((member) => (
                    <div key={member.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_180px_120px] sm:items-center">
                      <div>
                        <p className="font-semibold">{member.name}</p>
                        <p className="text-xs text-text-secondary">{member.phone ?? 'No phone on profile'}</p>
                      </div>
                      <select
                        value={member.role}
                        disabled={!canManage}
                        onChange={(event) => void updateMember(member.id, { role: event.target.value })}
                        className="rounded-lg border border-border-subtle bg-bg-elevated p-2 text-sm"
                      >
                        <option value="admin">Administrator</option>
                        <option value="manager">Manager</option>
                        <option value="salesperson">Sales Representative</option>
                        <option value="office">Office</option>
                        <option value="inspector">Inspector</option>
                      </select>
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => void updateMember(member.id, { is_active: !member.isActive })}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                          member.isActive ? 'bg-status-success/10 text-status-success' : 'bg-bg-elevated text-text-secondary'
                        }`}
                      >
                        {member.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                  ))
                )}
              </div>
              {error && <p className="p-4 text-xs text-status-critical">{error}</p>}
            </Card>
          )}

          {activeTab === 'leads' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Assignment Mode">
                  <select
                    value={valueString(settings['leads_settings'], 'assignment_mode', 'manual')}
                    onChange={(event) => patchSetting('leads_settings', { assignment_mode: event.target.value })}
                    className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-sm"
                  >
                    <option value="manual">Manual</option>
                    <option value="round_robin">Round Robin</option>
                    <option value="ai_recommended">AI Recommended</option>
                  </select>
                </Field>
                <Field label="Stale Lead After (days)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['leads_settings'], 'stale_lead_days', 14))}
                    onChange={(event) => patchSetting('leads_settings', { stale_lead_days: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Lead Response SLA (minutes)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['leads_settings'], 'response_sla_minutes', 15))}
                    onChange={(event) => patchSetting('leads_settings', { response_sla_minutes: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Default Appointment (minutes)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['leads_settings'], 'appointment_minutes', 60))}
                    onChange={(event) => patchSetting('leads_settings', { appointment_minutes: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Max Rep Workload">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['leads_settings'], 'max_rep_workload', 50))}
                    onChange={(event) => patchSetting('leads_settings', { max_rep_workload: Number(event.target.value) })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'storms' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Toggle
                  checked={valueBool(settings['storm_settings'], 'enable_wind', true)}
                  onChange={(checked) => patchSetting('storm_settings', { enable_wind: checked })}
                  label="Wind opportunities"
                  hint="Controls whether qualifying wind events can generate storm opportunities."
                  disabled={!canManage}
                />
                <Field label="Wind Threshold (MPH)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['storm_settings'], 'wind_threshold', 60))}
                    onChange={(event) => patchSetting('storm_settings', { wind_threshold: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Hail Threshold (inches)">
                  <TextInput
                    type="number"
                    step="0.25"
                    value={String(valueNumber(settings['storm_settings'], 'hail_threshold', 1))}
                    onChange={(event) => patchSetting('storm_settings', { hail_threshold: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Historical Lookback (months)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['storm_settings'], 'lookback_months', 24))}
                    onChange={(event) => patchSetting('storm_settings', { lookback_months: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Minimum Evidence Confidence (0–1)">
                  <TextInput
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={String(valueNumber(settings['storm_settings'], 'minimum_confidence', 0.65))}
                    onChange={(event) => patchSetting('storm_settings', { minimum_confidence: Number(event.target.value) })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'field' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Toggle
                  checked={valueBool(settings['gps_settings'], 'enable_tracking', true)}
                  onChange={(checked) => patchSetting('gps_settings', { enable_tracking: checked })}
                  label="Enable field GPS tracking"
                  hint="Used by routes, live distance, arrival detection, and manager visibility."
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['gps_settings'], 'high_accuracy', true)}
                  onChange={(checked) => patchSetting('gps_settings', { high_accuracy: checked })}
                  label="Prefer high-accuracy GPS"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['gps_settings'], 'allow_ip_fallback', true)}
                  onChange={(checked) => patchSetting('gps_settings', { allow_ip_fallback: checked })}
                  label="Allow approximate IP fallback"
                  hint="Fallback is labeled approximate and never treated as precise field GPS."
                  disabled={!canManage}
                />
                <Field label="Property Geofence Radius (meters)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['gps_settings'], 'property_geofence_radius', 100))}
                    onChange={(event) => patchSetting('gps_settings', { property_geofence_radius: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Default Near-Me Radius">
                  <select
                    value={String(valueNumber(settings['gps_settings'], 'default_search_radius_miles', 10))}
                    onChange={(event) => patchSetting('gps_settings', { default_search_radius_miles: Number(event.target.value) })}
                    className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-sm"
                  >
                    <option value="5">5 miles</option>
                    <option value="10">10 miles</option>
                    <option value="15">15 miles</option>
                    <option value="20">20 miles</option>
                  </select>
                </Field>
                <Field label="Location Stale After (seconds)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['gps_settings'], 'stale_after_seconds', 120))}
                    onChange={(event) => patchSetting('gps_settings', { stale_after_seconds: Number(event.target.value) })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'contacts' && (
            <>
              <Card className="space-y-5 p-5">
                {!contactSettings ? (
                  <p className="text-sm text-text-secondary">Loading provider configuration…</p>
                ) : (
                  <>
                    <Field label="Provider Entitlement">
                      <select
                        value={contactSettings.entitlement}
                        disabled={!canManage}
                        onChange={(event) =>
                          setContactSettings({
                            ...contactSettings,
                            entitlement: event.target.value as EnrichmentEntitlement,
                          })
                        }
                        className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-sm"
                      >
                        <option value="none">No provider connected</option>
                        <option value="consumer_subscription">Consumer subscription — blocked for lead generation</option>
                        <option value="business_api">Business API agreement</option>
                      </select>
                    </Field>
                    <Toggle
                      checked={contactSettings.credentialPresent}
                      onChange={(checked) => setContactSettings({ ...contactSettings, credentialPresent: checked })}
                      label="Server credential is present"
                      hint="This is only a status flag. API secrets belong in Supabase Edge Function secrets and are never stored in the browser."
                      disabled={!canManage}
                    />
                    <Toggle
                      checked={contactSettings.commercialUseConfirmed}
                      onChange={(checked) => setContactSettings({ ...contactSettings, commercialUseConfirmed: checked })}
                      label="Commercial prospecting is permitted by our provider agreement"
                      disabled={!canManage}
                    />
                    {contactSettings.commercialUseConfirmed && (
                      <Field label="Agreement / basis">
                        <TextInput
                          value={contactBasis}
                          disabled={!canManage}
                          onChange={(event) => setContactBasis(event.target.value)}
                          placeholder="e.g. BeenVerified Business home-services agreement"
                        />
                      </Field>
                    )}
                    <Toggle
                      checked={contactSettings.secondaryProvidersEnabled}
                      onChange={(checked) =>
                        setContactSettings({ ...contactSettings, secondaryProvidersEnabled: checked })
                      }
                      label="Allow paid fallback providers"
                      hint="Off by default so paid lookups are never triggered accidentally."
                      disabled={!canManage}
                    />
                    <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4 text-xs text-text-secondary">
                      <p className="font-semibold text-text-primary">Credential setup</p>
                      <p className="mt-1">
                        Add the approved provider API key as a server-side Supabase Edge Function secret. This UI intentionally never accepts or exposes raw secrets.
                      </p>
                    </div>
                  </>
                )}
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage || !contactSettings} onSave={() => void saveContactConfiguration()} />
            </>
          )}

          {activeTab === 'comms' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Toggle
                  checked={valueBool(settings['communications_settings'], 'enable_sms', false)}
                  onChange={(checked) => patchSetting('communications_settings', { enable_sms: checked })}
                  label="SMS"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['communications_settings'], 'enable_email', true)}
                  onChange={(checked) => patchSetting('communications_settings', { enable_email: checked })}
                  label="Email"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['communications_settings'], 'enable_voice', false)}
                  onChange={(checked) => patchSetting('communications_settings', { enable_voice: checked })}
                  label="Voice"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['communications_settings'], 'business_hours_only', true)}
                  onChange={(checked) => patchSetting('communications_settings', { business_hours_only: checked })}
                  label="Restrict automated outreach to business hours"
                  disabled={!canManage}
                />
                <Field label="Business Hours Start">
                  <TextInput
                    type="time"
                    value={valueString(settings['communications_settings'], 'business_hours_start', '08:00')}
                    onChange={(event) => patchSetting('communications_settings', { business_hours_start: event.target.value })}
                  />
                </Field>
                <Field label="Business Hours End">
                  <TextInput
                    type="time"
                    value={valueString(settings['communications_settings'], 'business_hours_end', '19:00')}
                    onChange={(event) => patchSetting('communications_settings', { business_hours_end: event.target.value })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'ai' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Autonomy Level">
                  <select
                    value={valueString(settings['ai_settings'], 'autonomy_level', 'assisted')}
                    onChange={(event) => patchSetting('ai_settings', { autonomy_level: event.target.value })}
                    className="w-full rounded-lg border border-border-subtle bg-bg-elevated p-2.5 text-sm"
                  >
                    <option value="manual">Manual</option>
                    <option value="assisted">Assisted</option>
                    <option value="guarded">Guarded Autonomy</option>
                    <option value="autopilot">Approved Autopilot</option>
                  </select>
                </Field>
                <Field label="Action Confidence Threshold">
                  <TextInput
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={String(valueNumber(settings['ai_settings'], 'confidence_threshold', 0.8))}
                    onChange={(event) => patchSetting('ai_settings', { confidence_threshold: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Human Handoff Threshold">
                  <TextInput
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={String(valueNumber(settings['ai_settings'], 'human_handoff_threshold', 0.6))}
                    onChange={(event) => patchSetting('ai_settings', { human_handoff_threshold: Number(event.target.value) })}
                  />
                </Field>
                <Toggle
                  checked={valueBool(settings['ai_settings'], 'enable_sms', false)}
                  onChange={(checked) => patchSetting('ai_settings', { enable_sms: checked })}
                  label="Allow AI SMS actions"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['ai_settings'], 'enable_voice', false)}
                  onChange={(checked) => patchSetting('ai_settings', { enable_voice: checked })}
                  label="Allow AI voice actions"
                  disabled={!canManage}
                />
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-5">
              <Card className="p-5">
                <h3 className="font-bold">Connection policy</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  API secrets are server-side only. Configure them in Supabase/Vercel provider secret stores, then validate them here from real traffic. Never paste production secrets into a browser form.
                </p>
              </Card>
              <IntegrationHealthPanel organizationId={orgId} />
            </div>
          )}

          {activeTab === 'notifications' && (
            <>
              <Card className="grid gap-3 p-5 sm:grid-cols-2">
                {([
                  ['notify_on_new_lead', 'New lead'],
                  ['notify_on_storm', 'Qualifying storm'],
                  ['notify_on_failed_job', 'Failed background job'],
                  ['notify_on_customer_reply', 'Customer reply'],
                  ['notify_on_assignment', 'Lead assignment'],
                  ['notify_on_gps_stale', 'Rep GPS stale'],
                ] as const).map(([key, label]) => (
                  <Toggle
                    key={key}
                    checked={valueBool(settings['notifications_settings'], key, true)}
                    onChange={(checked) => patchSetting('notifications_settings', { [key]: checked })}
                    label={label}
                    disabled={!canManage}
                  />
                ))}
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'insurance' && (
            <>
              <Card className="grid gap-3 p-5 sm:grid-cols-2">
                <Toggle
                  checked={valueBool(settings['insurance_settings'], 'allow_document_upload', true)}
                  onChange={(checked) => patchSetting('insurance_settings', { allow_document_upload: checked })}
                  label="Allow homeowner insurance document upload"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['insurance_settings'], 'require_human_review', true)}
                  onChange={(checked) => patchSetting('insurance_settings', { require_human_review: checked })}
                  label="Require human review"
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['insurance_settings'], 'require_homeowner_confirmation', true)}
                  onChange={(checked) => patchSetting('insurance_settings', { require_homeowner_confirmation: checked })}
                  label="Require homeowner confirmation of extracted policy information"
                  disabled={!canManage}
                />
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'privacy' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="General Retention (days)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['privacy_settings'], 'retention_days', 365))}
                    onChange={(event) => patchSetting('privacy_settings', { retention_days: Number(event.target.value) })}
                  />
                </Field>
                <Field label="GPS Retention (days)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['privacy_settings'], 'gps_retention_days', 90))}
                    onChange={(event) => patchSetting('privacy_settings', { gps_retention_days: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Communications Retention (days)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['privacy_settings'], 'communications_retention_days', 365))}
                    onChange={(event) => patchSetting('privacy_settings', { communications_retention_days: Number(event.target.value) })}
                  />
                </Field>
                <Field label="AI Transcript Retention (days)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['privacy_settings'], 'ai_transcript_retention_days', 180))}
                    onChange={(event) => patchSetting('privacy_settings', { ai_transcript_retention_days: Number(event.target.value) })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'security' && (
            <>
              <Card className="grid gap-4 p-5 sm:grid-cols-2">
                <Toggle
                  checked={valueBool(settings['security_settings'], 'require_mfa', false)}
                  onChange={(checked) => patchSetting('security_settings', { require_mfa: checked })}
                  label="Require MFA"
                  hint="This setting records policy intent; Auth configuration must also enforce it before the status is considered working."
                  disabled={!canManage}
                />
                <Toggle
                  checked={valueBool(settings['security_settings'], 'require_admin_for_integrations', true)}
                  onChange={(checked) => patchSetting('security_settings', { require_admin_for_integrations: checked })}
                  label="Admin-only integration changes"
                  disabled={!canManage}
                />
                <Field label="Session Timeout (minutes)">
                  <TextInput
                    type="number"
                    value={String(valueNumber(settings['security_settings'], 'session_timeout_minutes', 120))}
                    onChange={(event) => patchSetting('security_settings', { session_timeout_minutes: Number(event.target.value) })}
                  />
                </Field>
              </Card>
              <SaveBar saving={saving} saved={saved} error={error} disabled={!canManage} onSave={() => void saveSettings()} />
            </>
          )}

          {activeTab === 'compliance' && (
            <Card className="space-y-4 p-5">
              <h3 className="font-bold">Outreach guardrails</h3>
              <p className="text-sm text-text-secondary">
                Compliance is enforced by the communications/contact services. This panel exposes the active organization policy rather than pretending a UI toggle alone makes outreach lawful.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Business-hours enforcement</p>
                  <p className="mt-1 font-semibold">
                    {valueBool(settings['communications_settings'], 'business_hours_only', true) ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <div className="rounded-lg border border-border-subtle bg-bg-elevated/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Contact provider entitlement</p>
                  <p className="mt-1 font-semibold">{contactSettings?.entitlement ?? 'Not configured'}</p>
                </div>
              </div>
              <p className="text-xs text-text-secondary">
                DNC, SMS opt-out, unsubscribe, and suppression state are record-level controls and cannot be overridden from Settings.
              </p>
            </Card>
          )}

          {activeTab === 'health' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Health is based on actual provider and sync traffic wherever telemetry exists. Credentials alone never produce a green status.
              </p>
              <IntegrationHealthPanel organizationId={orgId} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
