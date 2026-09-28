import { useState } from 'react'
import { Card, Button, SectionTitle } from '@/components/ui'
import type { ManagedLead } from '@/features/leads/pipeline'
import { Clock, XCircle } from 'lucide-react'

export function StructuredFollowUpPanel({ lead }: { lead: ManagedLead }) {
  const [activePlan, setActivePlan] = useState<string | null>(null);

  // Derive default plan from LeadStatus
  let defaultPlanTitle = 'Standard Nurture';
  let defaultOptions = ['7 Day Follow-up', '30 Day Check-in'];

  if (lead.status === 'attempted') {
    defaultPlanTitle = 'No Answer Recovery';
    defaultOptions = ['Next attempt tomorrow', 'Alternate channel (if allowed)'];
  } else if (lead.status === 'estimate_proposal') {
    defaultPlanTitle = 'Proposal Sent Cadence';
    defaultOptions = ['24h initial check', '72h review', '7d final follow-up'];
  } else if (lead.status === 'interested') {
    defaultPlanTitle = 'Booking Nurture';
    defaultOptions = ['Call tomorrow morning', 'Text availability (if allowed)'];
  }

  return (
    <Card className="mt-4">
      <SectionTitle hint="Structured follow-up plans rather than generic reminders.">
        FOLLOW-UP ENGINE
      </SectionTitle>
      
      {!activePlan ? (
        <div className="mt-4">
          <p className="text-[12px] text-text-primary mb-2">Recommended Plan: <strong>{defaultPlanTitle}</strong></p>
          <div className="flex gap-2">
            {defaultOptions.map(opt => (
              <Button key={opt} variant="secondary" className="text-[11px]" onClick={() => setActivePlan(opt)}>
                + Add {opt}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 bg-bg-app border border-border-subtle p-3 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-[12px] font-bold text-text-primary flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-gold" />
              Active Follow-up: {activePlan}
            </h4>
            <button className="text-text-secondary hover:text-white" onClick={() => setActivePlan(null)}><XCircle className="w-4 h-4" /></button>
          </div>
          <div className="flex gap-2 mt-3">
             <Button variant="primary" className="text-[11px] flex-1 py-1">Complete</Button>
             <Button variant="secondary" className="text-[11px] flex-1 py-1">Snooze 24h</Button>
             <Button variant="secondary" className="text-[11px] flex-1 py-1">Reschedule</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export function LostReasonIntelligence() {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [selectedObjections, setSelectedObjections] = useState<string[]>([]);
  
  const lostReasons = ['price', 'competitor', 'timing', 'insurance', 'no_damage', 'financing', 'duplicate'];
  const objections = ['too_expensive', 'spouse_decision', 'already_has_roofer', 'wants_insurance_first', 'not_enough_damage', 'distrust'];

  const toggle = (list: string[], setList: any, item: string) => {
    if (list.includes(item)) setList(list.filter(i => i !== item));
    else setList([...list, item]);
  }

  return (
    <Card className="mt-4 border border-status-error/30 bg-status-error/5">
      <SectionTitle hint="Structured lost reasons for analytics.">
        MARK AS LOST
      </SectionTitle>
      
      <div className="mt-3">
        <p className="text-[11px] uppercase text-text-secondary font-bold mb-2">Lost Reason (Primary)</p>
        <div className="flex flex-wrap gap-2">
          {lostReasons.map(r => (
            <button 
              key={r}
              onClick={() => toggle(selectedReasons, setSelectedReasons, r)}
              className={`px-3 py-1 text-[11px] rounded-full border ${selectedReasons.includes(r) ? 'bg-status-error/20 border-status-error text-white' : 'bg-bg-app border-border-subtle text-text-secondary hover:bg-white/5'}`}
            >
              {r.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>
      
      <div className="mt-4">
        <p className="text-[11px] uppercase text-text-secondary font-bold mb-2">Objections Encountered (Multiple)</p>
        <div className="flex flex-wrap gap-2">
          {objections.map(r => (
            <button 
              key={r}
              onClick={() => toggle(selectedObjections, setSelectedObjections, r)}
              className={`px-3 py-1 text-[11px] rounded-full border ${selectedObjections.includes(r) ? 'bg-brand-primary/20 border-brand-primary text-white' : 'bg-bg-app border-border-subtle text-text-secondary hover:bg-white/5'}`}
            >
              {r.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>
      
      {selectedReasons.length > 0 && (
         <Button variant="primary" className="w-full mt-4 bg-status-error hover:bg-status-error/80 text-white border-status-error">
            Confirm Lost Lead
         </Button>
      )}
    </Card>
  )
}
