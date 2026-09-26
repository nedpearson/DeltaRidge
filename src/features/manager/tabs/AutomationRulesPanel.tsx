import { Card, SectionTitle } from '@/components/ui'

export function AutomationRulesPanel() {
  const rules = [
    { id: 1, name: 'Appointment Confirmation', condition: 'IF Appointment Created', action: 'THEN Send Confirmation', active: true },
    { id: 2, name: 'Proposal Viewed Notification', condition: 'IF Proposal Viewed', action: 'THEN Notify Rep', active: true },
    { id: 3, name: 'Stale Lead Re-engagement', condition: 'IF Lead idle > 14 days', action: 'THEN Add to Nurture Campaign', active: false },
    { id: 4, name: 'High-Value Lead Alert', condition: 'IF Lead Score >= A-', action: 'THEN Page Manager', active: true },
  ]

  return (
    <Card>
      <SectionTitle hint="Automation is rule-based. Add or modify rules to change system behavior without code changes.">
        AUTOMATION ENGINE
      </SectionTitle>

      <div className="mt-4 space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className={`flex items-start justify-between p-3 rounded-lg border ${rule.active ? 'border-border-subtle bg-bg-elevated' : 'border-white/5 bg-transparent opacity-60'}`}>
            <div>
                <p className="text-[13px] font-semibold">{rule.name}</p>
                <div className="mt-2 text-[11px] font-mono tracking-wide">
                    <span className="text-brand-gold">{rule.condition}</span>
                    <br />
                    <span className="text-brand-gold/70">{rule.action}</span>
                </div>
            </div>
            <div>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded ${rule.active ? 'bg-status-success/10 text-status-success' : 'bg-white/10 text-text-secondary'}`}>
                    {rule.active ? 'Active' : 'Paused'}
                </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border-subtle pt-3 text-center">
        <button className="text-[12px] text-brand-gold hover:underline">
          + Add New Rule
        </button>
      </div>
    </Card>
  )
}
