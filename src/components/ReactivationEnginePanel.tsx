
import { Card, Button, SectionTitle } from '@/components/ui'
import { RotateCcw, ShieldCheck, Heart } from 'lucide-react'

export function ReactivationEnginePanel() {
  return (
    <Card className="mt-4 border-brand-primary/30">
      <SectionTitle hint="Build factual reactivation segments from existing customer data.">
        REACTIVATION & NURTURE ENGINE
      </SectionTitle>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <RotateCcw className="w-5 h-5 text-brand-primary mb-2" />
               <p className="text-[12px] font-bold text-text-primary">Storm Reactivation</p>
               <p className="text-[10px] text-text-secondary mt-1">Cross-reference 15-year old roofs with recent 2" hail swath.</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1">View 42 Matches</Button>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <ShieldCheck className="w-5 h-5 text-status-success mb-2" />
               <p className="text-[12px] font-bold text-text-primary">RoofCare Conversions</p>
               <p className="text-[10px] text-text-secondary mt-1">Offer RoofCare memberships to past repair customers.</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1">View 115 Prospects</Button>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <Heart className="w-5 h-5 text-status-warning mb-2" />
               <p className="text-[12px] font-bold text-text-primary">Long-Term Nurture</p>
               <p className="text-[10px] text-text-secondary mt-1">Lost leads explicitly waiting for next season or financing.</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1">View 88 Leads</Button>
         </div>
      </div>
    </Card>
  )
}
