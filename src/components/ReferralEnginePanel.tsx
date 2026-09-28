
import { Card, Button, SectionTitle } from '@/components/ui'
import { Share2, Star, MapPin } from 'lucide-react'

export function ReferralEnginePanel({ status }: { status: string }) {
  if (status !== 'won' && status !== 'customer' && status !== 'inspected') {
    return null; // For demo, let it render if inspected too so we can see it
  }

  return (
    <Card className="mt-4 border-status-success/30 bg-status-success/5">
      <SectionTitle hint="Trigger referrals, reviews, and neighborhood halo campaigns post-sale.">
        POST-SALE ENGINE
      </SectionTitle>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <Share2 className="w-5 h-5 text-status-success mb-2" />
               <p className="text-[12px] font-bold text-text-primary">Referral Generator</p>
               <p className="text-[10px] text-text-secondary mt-1">Send a tracked 1-tap SMS referral link.</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1">Send Referral Link</Button>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <Star className="w-5 h-5 text-brand-gold mb-2" />
               <p className="text-[12px] font-bold text-text-primary">Review Engine</p>
               <p className="text-[10px] text-text-secondary mt-1">Request a Google review (Job Complete only).</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1">Request Review</Button>
         </div>

         <div className="bg-bg-app border border-border-subtle p-3 rounded-lg flex flex-col justify-between">
            <div>
               <MapPin className="w-5 h-5 text-brand-primary mb-2" />
               <p className="text-[12px] font-bold text-text-primary">Neighborhood Halo</p>
               <p className="text-[10px] text-text-secondary mt-1">68 qualifying properties within 0.75 mi.</p>
            </div>
            <Button variant="secondary" className="mt-3 text-[11px] w-full py-1 bg-brand-primary/10 text-brand-primary border-brand-primary/30">Launch Route</Button>
         </div>
      </div>
    </Card>
  )
}
