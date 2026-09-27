import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { BarChart3, TrendingUp, Users, CalendarCheck, DollarSign, ArrowRight } from 'lucide-react';

export default function SocialDashboardView() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['social_metrics_funnel'],
    queryFn: async () => {
      // In a real implementation, this would call a Supabase RPC or Edge Function to aggregate
      // For this view, we mock the aggregation shape for the UI
      return {
        funnel: {
          impressions: 45200,
          interactions: 3105,
          conversations: 412,
          qualified: 128,
          leadsCreated: 110,
          appointmentsOffered: 95,
          appointmentsBooked: 82,
          inspectionsCompleted: 75,
          proposalsSent: 60,
          jobsWon: 22
        },
        revenue: {
          pipeline: 850000,
          closedWon: 325000,
          cac: 145 // Customer Acquisition Cost
        },
        topCampaigns: [
          { id: 'c1', name: 'Ascension Hail Alert - Sept', spend: 450, revenue: 45000, roas: 100 },
          { id: 'c2', name: 'Dustin Explains Wind Damage', spend: 0, revenue: 28000, roas: 999 },
          { id: 'c3', name: 'Free Inspection Retargeting', spend: 1200, revenue: 110000, roas: 91 }
        ]
      };
    }
  });

  if (isLoading || !metrics) {
    return <div className="p-8 text-center text-text-secondary">Loading funnel analytics...</div>;
  }

  const funnelSteps = [
    { label: 'Interactions', value: metrics.funnel.interactions },
    { label: 'Conversations', value: metrics.funnel.conversations },
    { label: 'Qualified', value: metrics.funnel.qualified },
    { label: 'Leads', value: metrics.funnel.leadsCreated },
    { label: 'Appointments', value: metrics.funnel.appointmentsBooked },
    { label: 'Inspections', value: metrics.funnel.inspectionsCompleted },
    { label: 'Jobs Won', value: metrics.funnel.jobsWon }
  ];

  return (
    <div className="flex-1 bg-surface-50 p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text">Social Growth Dashboard</h1>
        <p className="text-text-secondary mt-1">Track the exact ROI of your content and social conversations.</p>
      </div>

      {/* High-level KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Users className="w-4 h-4" />
            <span className="text-sm font-medium">Active Conversations</span>
          </div>
          <div className="text-2xl font-semibold text-text">412</div>
          <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> +12% this week
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <CalendarCheck className="w-4 h-4" />
            <span className="text-sm font-medium">Social Appointments</span>
          </div>
          <div className="text-2xl font-semibold text-text">{metrics.funnel.appointmentsBooked}</div>
          <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> +5% this week
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <DollarSign className="w-4 h-4" />
            <span className="text-sm font-medium">Pipeline Generated</span>
          </div>
          <div className="text-2xl font-semibold text-text">${(metrics.revenue.pipeline / 1000).toFixed(1)}k</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-border shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <BarChart3 className="w-4 h-4" />
            <span className="text-sm font-medium">Closed Won</span>
          </div>
          <div className="text-2xl font-semibold text-brand-600">${(metrics.revenue.closedWon / 1000).toFixed(1)}k</div>
        </div>
      </div>

      {/* Funnel Visualization */}
      <div className="bg-white p-6 rounded-xl border border-border shadow-sm mb-8">
        <h2 className="text-lg font-semibold text-text mb-6">Conversion Funnel</h2>
        <div className="flex items-center justify-between">
          {funnelSteps.map((step, index) => (
            <div key={step.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-brand-50 border-2 border-brand-100 flex items-center justify-center text-brand-700 font-bold mb-2 shadow-sm">
                  {step.value}
                </div>
                <span className="text-xs font-medium text-text-secondary text-center">{step.label}</span>
              </div>
              {index < funnelSteps.length - 1 && (
                <div className="flex-1 h-px bg-border mx-2 relative">
                  <ArrowRight className="w-4 h-4 text-border absolute right-0 -top-2 bg-white" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Top Campaigns */}
      <div className="bg-white p-6 rounded-xl border border-border shadow-sm">
        <h2 className="text-lg font-semibold text-text mb-4">Top Performing Campaigns</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              <th className="pb-3 font-medium">Campaign</th>
              <th className="pb-3 font-medium">Spend</th>
              <th className="pb-3 font-medium">Revenue</th>
              <th className="pb-3 font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {metrics.topCampaigns.map(c => (
              <tr key={c.id}>
                <td className="py-3 font-medium text-text">{c.name}</td>
                <td className="py-3">${c.spend}</td>
                <td className="py-3">${c.revenue.toLocaleString()}</td>
                <td className="py-3 text-green-600 font-medium">{c.roas}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
