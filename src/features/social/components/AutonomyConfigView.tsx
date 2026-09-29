import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'
import { Shield, ToggleLeft, ToggleRight, AlertTriangle, Zap, Activity } from 'lucide-react'

type Config = {
  id: string
  organization_id: string
  auto_post_approved: boolean
  auto_respond_basic: boolean
  auto_book_appointments: boolean
  auto_launch_storm_campaigns: boolean
  max_daily_ad_spend: number
  require_approval_negative_reviews: boolean
  master_kill_switch: boolean
}

const CONTROL_FIELDS = [
  { key: 'auto_respond_basic', label: 'Auto-Reply to Inbound', desc: 'Allow the configured AI concierge to answer eligible inbound messages.' },
  { key: 'auto_book_appointments', label: 'Auto-Book Appointments', desc: 'Allow qualified conversations to book a real available field rep.' },
  { key: 'auto_launch_storm_campaigns', label: 'Auto-Launch Storm Campaigns', desc: 'Allow the storm campaign worker to create provider campaigns within the configured spend cap.' },
  { key: 'auto_post_approved', label: 'Auto-Publish Approved Content', desc: 'Allow approved, scheduled content to be published by the provider worker.' },
  { key: 'require_approval_negative_reviews', label: 'Require Approval for Negative-Review Responses', desc: 'Keep negative-review responses human-approved before any outbound action.' },
] as const

export default function AutonomyConfigView() {
  const { membership } = useSession()
  const orgId = membership?.organizationId ?? null
  const canManage = membership?.role === 'admin' || membership?.role === 'manager'
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState('0')
  const [savingBudget, setSavingBudget] = useState(false)

  const { data: config, isLoading, error: configError } = useQuery({
    queryKey: ['social_autonomy_config', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const supabase = getSupabase()
      if (!supabase || !orgId) throw new Error('Organization access is required.')
      const { data, error } = await supabase
        .from('social_autonomy_config')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle()
      if (error) throw error
      return data as Config | null
    },
  })

  useEffect(() => {
    setBudget(String(config?.max_daily_ad_spend ?? 0))
  }, [config?.max_daily_ad_spend])

  const { data: ledger = [], error: ledgerError } = useQuery({
    queryKey: ['automation_ledger', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const supabase = getSupabase()
      if (!supabase || !orgId) return []
      const { data, error } = await supabase
        .from('automation_ledger')
        .select('id, event_trigger, rule_name, action_attempted, result, details, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(25)
      if (error) throw error
      return data ?? []
    },
  })

  async function initializeConfig() {
    const supabase = getSupabase()
    if (!supabase || !orgId || !canManage) return
    setError(null)
    const { error: insertError } = await supabase.from('social_autonomy_config').insert({
      organization_id: orgId,
      auto_post_approved: false,
      auto_respond_basic: false,
      auto_book_appointments: false,
      auto_launch_storm_campaigns: false,
      max_daily_ad_spend: 0,
      require_approval_negative_reviews: true,
      master_kill_switch: true,
    })
    if (insertError) {
      setError(insertError.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['social_autonomy_config', orgId] })
  }

  async function toggleSetting(
    field: 'auto_post_approved' | 'auto_respond_basic' | 'auto_book_appointments' |
      'auto_launch_storm_campaigns' | 'require_approval_negative_reviews' | 'master_kill_switch',
    currentValue: boolean,
  ) {
    const supabase = getSupabase()
    if (!supabase || !config || !canManage) return
    setError(null)
    const { error: updateError } = await supabase
      .from('social_autonomy_config')
      .update({ [field]: !currentValue })
      .eq('id', config.id)
      .eq('organization_id', config.organization_id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['social_autonomy_config', orgId] })
  }

  async function saveBudget() {
    const supabase = getSupabase()
    if (!supabase || !config || !canManage) return
    const parsed = Number(budget)
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setError('Daily ad spend must be a whole number of dollars at or above zero.')
      return
    }
    setSavingBudget(true)
    setError(null)
    const { error: updateError } = await supabase
      .from('social_autonomy_config')
      .update({ max_daily_ad_spend: parsed })
      .eq('id', config.id)
      .eq('organization_id', config.organization_id)
    setSavingBudget(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['social_autonomy_config', orgId] })
  }

  if (!orgId) return <div className="p-8 text-center text-text-secondary">Organization access is required.</div>
  if (isLoading) return <div className="p-8 text-center text-text-secondary">Loading autonomy settings…</div>
  if (configError) return <div className="p-8 text-center text-status-error">Could not load autonomy settings: {configError instanceof Error ? configError.message : 'Unknown error'}</div>
  if (!config) {
    return (
      <div className="p-8 text-center">
        <p className="text-text-secondary">No autonomy configuration exists for this organization.</p>
        {canManage && (
          <button onClick={() => void initializeConfig()} className="mt-4 px-4 py-2 rounded bg-brand-primary text-white font-medium">
            Initialize Safe Defaults
          </button>
        )}
        {error && <p className="mt-3 text-status-error text-sm">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-app p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand-400" /> Autonomy Controls
        </h2>
        <p className="text-sm text-text-secondary mt-1">These settings are organization-scoped and server-enforced. Only managers/admins may change them.</p>
      </div>

      {error && <div className="mb-4 rounded border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{error}</div>}
      {ledgerError && <div className="mb-4 rounded border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning">Automation ledger could not be loaded.</div>}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-bg-card rounded-lg border border-border-subtle overflow-hidden">
            <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-brand-400" /><h3 className="font-medium text-text-primary">Master Kill Switch</h3></div>
              <button disabled={!canManage} onClick={() => void toggleSetting('master_kill_switch', config.master_kill_switch)} aria-label="Toggle master kill switch">
                {config.master_kill_switch ? <ToggleRight className="w-10 h-10 text-status-critical" /> : <ToggleLeft className="w-10 h-10 text-text-secondary" />}
              </button>
            </div>
            <p className="px-4 pb-4 text-xs text-text-secondary">
              {config.master_kill_switch ? 'ACTIVE — automated outbound actions must remain stopped.' : 'Inactive — individual permissions below may execute when their other safeguards pass.'}
            </p>

            <div className="divide-y divide-border-subtle border-t border-border-subtle">
              {CONTROL_FIELDS.map((control) => (
                <div key={control.key} className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">{control.label}</h4>
                    <p className="text-xs text-text-secondary mt-0.5">{control.desc}</p>
                  </div>
                  <button disabled={!canManage} onClick={() => void toggleSetting(control.key, config[control.key])} aria-label={'Toggle ' + control.label}>
                    {config[control.key] ? <ToggleRight className="w-10 h-10 text-status-success" /> : <ToggleLeft className="w-10 h-10 text-text-secondary opacity-50" />}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-warning-surface/20 border border-warning-border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning-highlight shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-warning-highlight">Storm Campaign Daily Spend Cap</h4>
                <div className="mt-2 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={budget}
                    disabled={!canManage}
                    onChange={(event) => setBudget(event.target.value)}
                    className="w-32 rounded border border-border-subtle bg-bg-app px-3 py-2 text-sm text-text-primary"
                  />
                  <button disabled={!canManage || savingBudget} onClick={() => void saveBudget()} className="rounded bg-brand-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {savingBudget ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <p className="text-xs text-text-secondary mt-2">$0 prevents autonomous storm campaign spend.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-bg-card rounded-lg border border-border-subtle flex flex-col">
          <div className="p-4 border-b border-border-subtle flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-400" />
            <h3 className="font-medium text-text-primary">Automation Ledger</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {ledger.length === 0 ? (
              <div className="p-8 text-center text-text-secondary text-sm">No autonomous actions recorded yet.</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {ledger.map((log) => (
                  <div key={String(log.id)} className="p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider bg-bg-elevated px-1.5 py-0.5 rounded">{String(log.rule_name)}</span>
                      <span className="text-[10px] text-text-secondary">{new Date(String(log.created_at)).toLocaleString()}</span>
                      <span className="text-[10px] uppercase text-text-secondary">{String(log.result)}</span>
                    </div>
                    <p className="text-sm text-text-primary">{String(log.action_attempted)}</p>
                    <p className="mt-1 text-xs text-text-secondary">Trigger: {String(log.event_trigger)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
