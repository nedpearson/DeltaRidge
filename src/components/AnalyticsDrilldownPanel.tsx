
import { Card, SectionTitle } from '@/components/ui'

export function AnalyticsDrilldownPanel() {
  return (
    <Card className="mt-4">
      <SectionTitle hint="Slice conversion rates by source, response time, and property opportunity score.">
        CONVERSION DRILLDOWNS
      </SectionTitle>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
         
         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg">
            <h4 className="text-[11px] font-bold uppercase text-text-secondary mb-3">By Source</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Referral</span>
                 <span className="font-bold text-status-success">38% Won</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Direct Mail</span>
                 <span className="font-bold text-brand-gold">14% Won</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Door Knock (Cold)</span>
                 <span className="font-bold text-text-secondary">4% Won</span>
              </div>
            </div>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg">
            <h4 className="text-[11px] font-bold uppercase text-text-secondary mb-3">By Response Time</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">&lt; 5m</span>
                 <span className="font-bold text-status-success">22% Appt</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">5-15m</span>
                 <span className="font-bold text-brand-gold">15% Appt</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">&gt; 30m</span>
                 <span className="font-bold text-status-error">3% Appt</span>
              </div>
            </div>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg">
            <h4 className="text-[11px] font-bold uppercase text-text-secondary mb-3">By Opportunity Band</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Band A+</span>
                 <span className="font-bold text-status-success">42% Won</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Band B</span>
                 <span className="font-bold text-brand-gold">18% Won</span>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                 <span className="text-text-primary">Band D</span>
                 <span className="font-bold text-text-secondary">2% Won</span>
              </div>
            </div>
         </div>
      </div>
      
      <p className="text-[10px] text-text-secondary italic mt-3 text-center">
         * Clicking any metric drills down directly into the supporting records. Only reporting statistically meaningful cohorts (N &gt; 30).
      </p>
    </Card>
  )
}
