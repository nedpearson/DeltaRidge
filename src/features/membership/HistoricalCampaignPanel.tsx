import { Card, Button } from '@/components/ui'
import { CalendarDays, AlertTriangle } from 'lucide-react'

export function HistoricalCampaignPanel() {
  return (
    <Card className="p-4 bg-brand-primary/10 border-brand-primary/20 mt-4">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="w-5 h-5 text-brand-primary" />
            <h3 className="text-[14px] font-bold text-text-primary uppercase tracking-widest">Historical RoofCare Campaign</h3>
            <span className="text-[10px] font-bold bg-brand-primary text-bg-app px-2 py-0.5 rounded-full uppercase">Beta</span>
          </div>
          <p className="text-[12px] text-text-secondary leading-relaxed max-w-lg">
            Skip the storm chasing. This view identifies aging roofs (8+ years old) in your immediate territory that haven't been replaced since their last permit. Pitch a RoofCare Pre-Storm Inspection.
          </p>
        </div>
        <Button variant="primary" className="text-[12px] whitespace-nowrap">
          Load Aging Roofs
        </Button>
      </div>
      
      <div className="grid grid-cols-3 gap-4 mt-4 border-t border-border-subtle pt-4">
        <div>
          <p className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Permits Searched</p>
          <p className="text-[16px] font-bold text-text-primary mt-1">1,402</p>
        </div>
        <div>
          <p className="text-[11px] text-text-muted uppercase font-bold tracking-wider">Roofs 8+ Years Old</p>
          <p className="text-[16px] font-bold text-text-primary mt-1">314</p>
        </div>
        <div>
          <p className="text-[11px] text-text-muted uppercase font-bold tracking-wider">No Recent Replacement</p>
          <p className="text-[16px] font-bold text-status-warning mt-1 flex items-center gap-1">
            287 <AlertTriangle className="w-3 h-3" />
          </p>
        </div>
      </div>
    </Card>
  )
}


