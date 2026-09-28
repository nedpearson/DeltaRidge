
import { Card, SectionTitle, Button } from '@/components/ui'
import { ShieldAlert, Play, Pause, Edit2, Zap } from 'lucide-react'

export function AutomationRulesPanel() {
  const rules = [
    { id: 1, name: 'Proposal Follow-up', event: 'Proposal Sent', condition: 'Not signed after 48h', action: 'Create high-priority follow-up', active: true, owner: 'Sales Ops', triggered: '12m ago' },
    { id: 2, name: 'Speed to Lead Escalation', event: 'Inbound Lead Assigned', condition: 'Uncontacted > 15m', action: 'Reassign & Alert Manager', active: true, owner: 'Admin', triggered: '2h ago' },
    { id: 3, name: 'Neighborhood Halo Campaign', event: 'Job Completed', condition: 'Margin > 15%', action: 'Launch Direct Mail (Requires Approval)', active: false, owner: 'Marketing', triggered: 'Never' },
    { id: 4, name: 'Appointment Confirmation', event: 'Appointment Created', condition: 'Phone is mobile', action: 'Send SMS Confirmation', active: true, owner: 'Sales Ops', triggered: '4m ago' },
  ]

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Configure deterministic triggers, conditions, and actions.">
          AUTOMATION ENGINE
        </SectionTitle>
        <Button variant="primary" className="py-1.5 px-3 text-[11px] font-bold">+ New Rule</Button>
      </div>

      <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-lg p-3 flex gap-3 items-start text-[12px] text-text-primary">
        <ShieldAlert className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-bold">Automation Safety Guardrails Active</p>
          <p className="text-text-secondary mt-0.5">Rules involving money, mass communication, or reassignment require explicit approval thresholds before execution.</p>
        </div>
      </div>

      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className={`flex flex-col p-4 rounded-xl border ${rule.active ? 'border-border-subtle bg-bg-elevated' : 'border-white/5 bg-transparent opacity-60'}`}>
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${rule.active ? 'text-brand-gold' : 'text-text-secondary'}`} />
                  <p className="text-[14px] font-bold text-text-primary">{rule.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-secondary uppercase">Owner: {rule.owner}</span>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded ${rule.active ? 'bg-status-success/15 text-status-success' : 'bg-white/10 text-text-secondary'}`}>
                      {rule.active ? 'Active' : 'Paused'}
                  </span>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[12px]">
              <div className="bg-bg-app border border-border-subtle p-2 rounded">
                 <span className="text-[10px] text-text-secondary uppercase block mb-1">Event</span>
                 <span className="font-medium">{rule.event}</span>
              </div>
              <div className="bg-bg-app border border-border-subtle p-2 rounded">
                 <span className="text-[10px] text-text-secondary uppercase block mb-1">Condition</span>
                 <span className="font-medium">{rule.condition}</span>
              </div>
              <div className="bg-bg-app border border-brand-gold/30 p-2 rounded shadow-sm shadow-brand-gold/5">
                 <span className="text-[10px] text-text-secondary uppercase block mb-1">Action</span>
                 <span className="font-medium text-brand-gold">{rule.action}</span>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle/50">
               <span className="text-[10px] text-text-secondary">Last triggered: {rule.triggered}</span>
               <div className="flex gap-2">
                 <button className="p-1 text-text-secondary hover:text-white"><Edit2 className="w-3.5 h-3.5" /></button>
                 <button className="p-1 text-text-secondary hover:text-white">{rule.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>
               </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
