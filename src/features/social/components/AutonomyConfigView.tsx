import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { Shield, ToggleLeft, ToggleRight, AlertTriangle, Zap, Activity } from 'lucide-react';

export default function AutonomyConfigView() {
  const { data: config, isLoading, refetch } = useQuery({
    queryKey: ['social_autonomy_config'],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('social_autonomy_config')
        .select('*')
        .limit(1)
        .single();
      
      if (error) throw error;
      return data;
    }
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ['automation_ledger'],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) return [];
      const { data } = await supabase
        .from('automation_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      return data || [];
    }
  });

  const toggleSetting = async (field: string, currentValue: boolean) => {
    const supabase = getSupabase();
    if (!supabase || !config) return;
    
    await supabase
      .from('social_autonomy_config')
      .update({ [field]: !currentValue })
      .eq('id', config.id);
      
    refetch();
  };

  if (isLoading) return <div className="p-8 text-center">Loading Autonomy Settings...</div>;
  if (!config) return <div className="p-8 text-center text-red-500">Failed to load configuration.</div>;

  const toggles = [
    { key: 'auto_respond_basic', label: 'Auto-Reply to Inbound', desc: 'AI answers DMs and comments automatically.' },
    { key: 'auto_book_appointments', label: 'Auto-Book Appointments', desc: 'AI can schedule inspections directly onto the rep calendar.' },
    { key: 'auto_launch_storm_campaigns', label: 'Auto-Launch Storm Campaigns', desc: 'Automatically buy Meta ads when severe hail hits.' },
    { key: 'auto_post_approved', label: 'Autonomous Attribution & Budgets', desc: 'AI adjusts ad budgets based on CRM closed-won revenue.' },
    { key: 'require_approval_negative_reviews', label: 'Automated Review Requests', desc: 'Send review requests 24h after a completed job.' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-50 p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand-600" />
          Autonomy Configuration (God Mode)
        </h2>
        <p className="text-sm text-text-secondary mt-1">
          Control exactly which systems Delta Ridge OS is allowed to execute autonomously without human approval.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-surface-50 flex items-center gap-2">
              <Shield className="w-4 h-4 text-brand-600" />
              <h3 className="font-medium text-text">System Permissions</h3>
            </div>
            <div className="divide-y divide-border">
              {toggles.map(t => (
                <div key={t.key} className="p-4 flex items-center justify-between hover:bg-surface-50 transition-colors">
                  <div>
                    <h4 className="text-sm font-medium text-text">{t.label}</h4>
                    <p className="text-xs text-text-secondary mt-0.5">{t.desc}</p>
                  </div>
                  <button 
                    onClick={() => toggleSetting(t.key, config[t.key])}
                    className="focus:outline-none"
                  >
                    {config[t.key] ? (
                      <ToggleRight className="w-10 h-10 text-status-success" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-text-secondary opacity-50" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
          
          <div className="bg-warning-surface/20 border border-warning-border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning-highlight shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-warning-highlight">Financial Guardrails</h4>
                <p className="text-xs text-text-secondary mt-1">
                  Maximum daily budget the AI can allocate to a new storm campaign without human approval is 
                  <span className="font-semibold text-text ml-1">${config.max_daily_ad_spend}.00</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Ledger Log */}
        <div className="bg-white rounded-lg border border-border shadow-sm flex flex-col">
          <div className="p-4 border-b border-border bg-surface-50 flex items-center gap-2">
            <Activity className="w-4 h-4 text-brand-600" />
            <h3 className="font-medium text-text">Automation Ledger</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-0">
            {ledger.length === 0 ? (
              <div className="p-8 text-center text-text-secondary text-sm">No autonomous actions recorded yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {ledger.map((log: Record<string, unknown>) => (
                  <div key={String(log.id)} className="p-4 hover:bg-surface-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider bg-surface-100 px-1.5 py-0.5 rounded">
                        {String(log.action_type).replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-text-secondary">
                        {new Date(String(log.created_at)).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-text leading-snug">{String(log.description)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

