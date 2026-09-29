import { useQuery } from '@tanstack/react-query'
import { BarChart3, Users, CalendarCheck, DollarSign, ArrowRight } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'

type CampaignRow = { id: string; name: string }
type SpendRow = { campaign_id: string | null; amount: number }
type ConversationRow = { lead_id: string | null; status: string; intent_category: string | null }
type LeadRow = { id: string; status: string; utm_campaign: string | null }
type RoofrRow = {
  lead_id: string
  proposal_sent_at: string | null
  proposal_signed_at: string | null
  proposal_lost_at: string | null
  proposal_total_cents: number | null
}

const QUALIFIED_INTENTS = new Set(['emergency', 'hot', 'warm', 'storm'])

export default function SocialDashboardView() {
  const { membership } = useSession()
  const orgId = membership?.organizationId ?? null

  const { data: metrics, isLoading, error } = useQuery({
    queryKey: ['social_metrics_funnel', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const supabase = getSupabase()
      if (!supabase || !orgId) throw new Error('Organization access is required.')

      const [campaignsResult, ledgerResult, conversationsResult, calendarResult] = await Promise.all([
        supabase.from('marketing_campaigns').select('id, name').eq('organization_id', orgId),
        supabase.from('marketing_spend_ledger').select('campaign_id, amount').eq('organization_id', orgId),
        supabase.from('social_conversations').select('lead_id, status, intent_category').eq('organization_id', orgId),
        supabase.from('content_calendar').select('performance_metrics, campaign_id').eq('organization_id', orgId),
      ])

      for (const result of [campaignsResult, ledgerResult, conversationsResult, calendarResult]) {
        if (result.error) throw result.error
      }

      const campaigns = (campaignsResult.data ?? []) as CampaignRow[]
      const ledger = (ledgerResult.data ?? []) as SpendRow[]
      const conversations = (conversationsResult.data ?? []) as ConversationRow[]
      const calendar = calendarResult.data ?? []
      const leadIds = [...new Set(conversations.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))]

      let leads: LeadRow[] = []
      let appointments: { id: string; lead_id: string | null }[] = []
      let inspections: { id: string; lead_id: string | null; status: string }[] = []
      let roofrLinks: RoofrRow[] = []

      if (leadIds.length > 0) {
        const [leadResult, appointmentResult, inspectionResult, roofrResult] = await Promise.all([
          supabase.from('leads').select('id, status, utm_campaign').eq('organization_id', orgId).in('id', leadIds),
          supabase.from('appointments').select('id, lead_id').eq('organization_id', orgId).in('lead_id', leadIds),
          supabase.from('inspections').select('id, lead_id, status').eq('organization_id', orgId).in('lead_id', leadIds),
          supabase
            .from('roofr_links')
            .select('lead_id, proposal_sent_at, proposal_signed_at, proposal_lost_at, proposal_total_cents')
            .eq('organization_id', orgId)
            .in('lead_id', leadIds),
        ])

        for (const result of [leadResult, appointmentResult, inspectionResult, roofrResult]) {
          if (result.error) throw result.error
        }

        leads = (leadResult.data ?? []) as LeadRow[]
        appointments = appointmentResult.data ?? []
        inspections = inspectionResult.data ?? []
        roofrLinks = (roofrResult.data ?? []) as RoofrRow[]
      }

      let impressions = 0
      let interactions = 0
      for (const row of calendar) {
        const pm = row.performance_metrics
        if (!pm || typeof pm !== 'object') continue
        const typed = pm as Record<string, unknown>
        if (typeof typed.impressions === 'number') impressions += typed.impressions
        if (typeof typed.interactions === 'number') interactions += typed.interactions
        else if (typeof typed.clicks === 'number') interactions += typed.clicks
      }

      const activeConversations = conversations.filter((row) => row.status === 'open' || row.status === 'bot_handling').length
      const qualified = conversations.filter((row) => row.intent_category && QUALIFIED_INTENTS.has(row.intent_category)).length
      const completedInspections = inspections.filter((row) => row.status === 'complete' || row.status === 'sent_to_office').length
      const proposalsSent = roofrLinks.filter((row) => row.proposal_sent_at !== null).length
      const jobsWon = leads.filter((row) => row.status === 'sold').length

      const closedWonCents = roofrLinks.reduce(
        (sum, row) => sum + (row.proposal_signed_at ? Number(row.proposal_total_cents ?? 0) : 0),
        0,
      )
      const pipelineCents = roofrLinks.reduce(
        (sum, row) =>
          sum + (row.proposal_sent_at && !row.proposal_signed_at && !row.proposal_lost_at
            ? Number(row.proposal_total_cents ?? 0)
            : 0),
        0,
      )

      const campaignMap = new Map(
        campaigns.map((campaign) => [campaign.id, {
          id: campaign.id,
          name: campaign.name,
          spend: 0,
          revenueCents: 0,
        }]),
      )

      for (const spend of ledger) {
        if (spend.campaign_id && campaignMap.has(spend.campaign_id)) {
          campaignMap.get(spend.campaign_id)!.spend += Number(spend.amount ?? 0)
        }
      }

      const leadById = new Map(leads.map((lead) => [lead.id, lead]))
      const campaignByName = new Map(campaigns.map((campaign) => [campaign.name, campaign.id]))
      for (const link of roofrLinks) {
        if (!link.proposal_signed_at || !link.proposal_total_cents) continue
        const lead = leadById.get(link.lead_id)
        if (!lead?.utm_campaign) continue
        const campaignId = campaignByName.get(lead.utm_campaign)
        if (!campaignId) continue
        campaignMap.get(campaignId)!.revenueCents += Number(link.proposal_total_cents)
      }

      const topCampaigns = Array.from(campaignMap.values())
        .map((campaign) => ({
          ...campaign,
          roas: campaign.spend > 0 ? (campaign.revenueCents / 100) / campaign.spend : null,
        }))
        .sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1))

      const totalSpend = ledger.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

      return {
        funnel: {
          impressions,
          interactions,
          conversations: activeConversations,
          qualified,
          leadsCreated: leadIds.length,
          appointmentsBooked: appointments.length,
          inspectionsCompleted: completedInspections,
          proposalsSent,
          jobsWon,
        },
        revenue: {
          pipelineCents,
          closedWonCents,
          cac: jobsWon > 0 ? totalSpend / jobsWon : null,
        },
        topCampaigns,
      }
    },
  })

  if (!orgId) {
    return <div className="p-8 text-center text-text-secondary">Organization access is required for social analytics.</div>
  }
  if (isLoading) {
    return <div className="p-8 text-center text-text-secondary">Loading funnel analytics…</div>
  }
  if (error || !metrics) {
    return <div className="p-8 text-center text-status-error">Social analytics could not be loaded: {error instanceof Error ? error.message : 'Unknown error'}</div>
  }

  const funnelSteps = [
    { label: 'Interactions', value: metrics.funnel.interactions },
    { label: 'Conversations', value: metrics.funnel.conversations },
    { label: 'Qualified', value: metrics.funnel.qualified },
    { label: 'Leads', value: metrics.funnel.leadsCreated },
    { label: 'Appointments', value: metrics.funnel.appointmentsBooked },
    { label: 'Inspections', value: metrics.funnel.inspectionsCompleted },
    { label: 'Proposals', value: metrics.funnel.proposalsSent },
    { label: 'Jobs Won', value: metrics.funnel.jobsWon },
  ]

  return (
    <div className="flex-1 bg-bg-app p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Social Growth Dashboard</h1>
        <p className="text-text-secondary mt-1">Only persisted conversations, CRM records, provider events, spend and revenue are counted.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-bg-card p-5 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-2 text-text-secondary mb-2"><Users className="w-4 h-4" /><span className="text-sm font-medium">Active Conversations</span></div>
          <div className="text-2xl font-semibold text-text-primary">{metrics.funnel.conversations}</div>
        </div>
        <div className="bg-bg-card p-5 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-2 text-text-secondary mb-2"><CalendarCheck className="w-4 h-4" /><span className="text-sm font-medium">Social Appointments</span></div>
          <div className="text-2xl font-semibold text-text-primary">{metrics.funnel.appointmentsBooked}</div>
        </div>
        <div className="bg-bg-card p-5 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-2 text-text-secondary mb-2"><DollarSign className="w-4 h-4" /><span className="text-sm font-medium">Open Proposal Pipeline</span></div>
          <div className="text-2xl font-semibold text-text-primary">{'$' + (metrics.revenue.pipelineCents / 100).toLocaleString()}</div>
        </div>
        <div className="bg-bg-card p-5 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-2 text-text-secondary mb-2"><BarChart3 className="w-4 h-4" /><span className="text-sm font-medium">Signed Proposal Revenue</span></div>
          <div className="text-2xl font-semibold text-brand-400">{'$' + (metrics.revenue.closedWonCents / 100).toLocaleString()}</div>
          <div className="text-xs text-text-secondary mt-1">CAC: {metrics.revenue.cac === null ? 'N/A' : '$' + metrics.revenue.cac.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-bg-card p-6 rounded-xl border border-border-subtle mb-8 overflow-x-auto">
        <h2 className="text-lg font-semibold text-text-primary mb-6">Measured Funnel</h2>
        <div className="flex items-center min-w-[820px]">
          {funnelSteps.map((step, index) => (
            <div key={step.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-brand-primary/10 border-2 border-brand-primary/20 flex items-center justify-center text-brand-400 font-bold mb-2">
                  {step.value}
                </div>
                <span className="text-xs font-medium text-text-secondary text-center">{step.label}</span>
              </div>
              {index < funnelSteps.length - 1 && (
                <div className="flex-1 h-px bg-border-subtle mx-2 relative">
                  <ArrowRight className="w-4 h-4 text-text-secondary absolute right-0 -top-2 bg-bg-card" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-card p-6 rounded-xl border border-border-subtle">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Campaign Attribution</h2>
        {metrics.topCampaigns.length === 0 ? (
          <p className="text-sm text-text-secondary">No marketing campaigns have been recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="pb-3 font-medium">Campaign</th>
                  <th className="pb-3 font-medium">Recorded Spend</th>
                  <th className="pb-3 font-medium">Signed Revenue</th>
                  <th className="pb-3 font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {metrics.topCampaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="py-3 font-medium text-text-primary">{campaign.name}</td>
                    <td className="py-3">{'$' + campaign.spend.toLocaleString()}</td>
                    <td className="py-3">{'$' + (campaign.revenueCents / 100).toLocaleString()}</td>
                    <td className="py-3">{campaign.roas === null ? 'N/A' : campaign.roas.toFixed(2) + 'x'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
