
import { Card, Button } from '@/components/ui'
import type { ManagedLead } from '@/features/leads/pipeline'
import { Calendar, Phone, CheckSquare, MessageSquare } from 'lucide-react'

export default function NextBestActionPanel({ lead }: { lead: ManagedLead }) {
  // A deterministic recommendation layer based on rules.
  let recommendation = null;

  // Rule 1: Appointment missing after interest
  if (lead.status === 'interested') {
    recommendation = {
      action: 'Book inspection',
      reason: 'Homeowner said interested but no appointment exists.',
      icon: <Calendar className="w-5 h-5" />
    }
  }
  // Rule 2: Follow up proposal
  else if (lead.status === 'estimate_proposal' || lead.status === 'inspected') {
    recommendation = {
      action: 'Follow up proposal',
      reason: 'Proposal was sent or roof inspected. Pending decision.',
      icon: <MessageSquare className="w-5 h-5" />
    }
  }
  // Rule 3: Need visit or follow up
  else if (lead.status === 'need_visit' || lead.status === 'follow_up') {
    recommendation = {
      action: 'Revisit property',
      reason: 'Homeowner requested a return visit.',
      icon: <CheckSquare className="w-5 h-5" />
    }
  }
  // Rule 4: Not home / Attempted
  else if (lead.status === 'attempted') {
    recommendation = {
      action: 'Call or return later',
      reason: 'No answer on last attempt.',
      icon: <Phone className="w-5 h-5" />
    }
  }
  
  if (!recommendation) return null;

  return (
    <Card className="mb-4 border-l-4 border-l-brand-400 bg-brand-primary/5">
      <div className="flex gap-3">
        <div className="mt-1 text-brand-primary">{recommendation.icon}</div>
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Next Best Action</h3>
          <p className="text-[14px] font-bold text-text-primary mt-0.5">{recommendation.action}</p>
          <div className="mt-1 text-[11px] text-text-secondary border-t border-brand-primary/10 pt-1">
             <span className="font-semibold text-brand-primary/80 uppercase mr-1">Why Now:</span> 
             {recommendation.reason}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="py-2 px-4 text-[12px] font-bold" onClick={() => console.warn(recommendation.action)}>Execute</Button>
            <Button variant="ghost" className="py-2 px-3 text-[12px]">Snooze</Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
