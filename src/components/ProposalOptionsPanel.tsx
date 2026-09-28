import { useState } from 'react'
import { Card, Button, SectionTitle } from '@/components/ui'
import { Eye, CheckCircle2, ShieldAlert } from 'lucide-react'

export function ProposalOptionsPanel() {
  const [discount, setDiscount] = useState(0);
  
  const baseMargin = 32;
  const currentMargin = baseMargin - discount;

  return (
    <Card className="mt-4 border-brand-primary/30">
      <div className="flex items-center justify-between mb-4">
        <SectionTitle hint="Configure proposal options and discount guardrails.">
          PROPOSAL OPTIONS
        </SectionTitle>
        <span className="text-[10px] text-text-secondary uppercase">Status: <span className="text-status-success font-bold">VIEWED</span></span>
      </div>

      <div className="mb-4">
        <p className="text-[11px] uppercase text-text-secondary font-bold mb-2">Proposal Engagement Tracking</p>
        <div className="flex items-center gap-4 text-[11px]">
          <div className="flex items-center gap-1 text-text-secondary">
             <CheckCircle2 className="w-3.5 h-3.5" /> Sent 24h ago
          </div>
          <div className="flex items-center gap-1 text-brand-gold">
             <Eye className="w-3.5 h-3.5" /> Viewed 3 times
          </div>
          <div className="flex items-center gap-1 text-text-muted">
             <CheckCircle2 className="w-3.5 h-3.5 opacity-50" /> Signed (Pending)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-bg-app border border-border-subtle p-3 rounded-lg text-center cursor-pointer hover:border-brand-primary/50">
           <p className="text-[12px] font-bold text-text-primary">GOOD</p>
           <p className="text-[10px] text-text-secondary mt-1">Basic Shingle</p>
           <p className="text-[13px] font-bold text-brand-gold mt-1">$12,000</p>
        </div>
        <div className="bg-brand-primary/10 border border-brand-primary p-3 rounded-lg text-center cursor-pointer">
           <p className="text-[12px] font-bold text-text-primary">BETTER</p>
           <p className="text-[10px] text-text-secondary mt-1">Architectural</p>
           <p className="text-[13px] font-bold text-brand-gold mt-1">$14,500</p>
        </div>
        <div className="bg-bg-app border border-border-subtle p-3 rounded-lg text-center cursor-pointer hover:border-brand-primary/50">
           <p className="text-[12px] font-bold text-text-primary">BEST</p>
           <p className="text-[10px] text-text-secondary mt-1">Premium</p>
           <p className="text-[13px] font-bold text-brand-gold mt-1">$18,200</p>
        </div>
      </div>

      <div className="bg-bg-elevated p-3 rounded-lg border border-border-subtle">
        <div className="flex justify-between items-center mb-2">
           <p className="text-[11px] font-bold uppercase text-text-secondary">Discount & Margin Guardrails</p>
           <span className={`text-[12px] font-bold ${currentMargin < 20 ? 'text-status-error' : 'text-status-success'}`}>
             {currentMargin}% Margin
           </span>
        </div>
        
        <input 
          type="range" 
          min="0" 
          max="20" 
          value={discount} 
          onChange={(e) => setDiscount(Number(e.target.value))}
          className="w-full accent-brand-primary"
        />
        <div className="flex justify-between mt-1 text-[10px] text-text-secondary">
          <span>0% discount</span>
          <span>20% discount</span>
        </div>
        
        {currentMargin < 20 && (
          <div className="mt-3 bg-status-error/10 border border-status-error/30 p-2 rounded text-[11px] text-status-error flex gap-2 items-center">
             <ShieldAlert className="w-4 h-4 shrink-0" />
             Margin below minimum threshold (20%). Manager approval required to send.
          </div>
        )}
      </div>
      
      <Button variant={currentMargin < 20 ? 'secondary' : 'primary'} className="w-full mt-4" disabled={currentMargin < 20}>
         {currentMargin < 20 ? 'Request Manager Approval' : 'Send Proposal Draft'}
      </Button>
    </Card>
  )
}
