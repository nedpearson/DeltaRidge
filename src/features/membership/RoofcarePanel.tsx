import { Card, Button } from '@/components/ui'
import { ShieldCheck, Star } from 'lucide-react'

export function RoofcareOfferPanel({ onEnroll }: { onEnroll?: (tier: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-brand-gold" />
        <h3 className="text-[16px] font-bold text-text-primary">Protect this Roof with RoofCare™</h3>
      </div>
      <p className="text-[13px] text-text-secondary">
        Don't wait for the next major storm to find out if your roof survived. RoofCare members receive proactive annual inspections, priority post-storm deployment, and exclusive repair discounts.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        {/* Standard Tier */}
        <Card className="p-4 border border-border-subtle flex flex-col justify-between">
          <div>
            <h4 className="text-[14px] font-bold text-text-primary mb-1">Standard Protection</h4>
            <p className="text-[20px] font-black text-text-primary mb-3">$19<span className="text-[12px] text-text-muted font-normal">/mo</span></p>
            <ul className="text-[12px] text-text-secondary space-y-2 mb-4">
              <li>✓ Annual Comprehensive Inspection</li>
              <li>✓ Digital Roof Health Report</li>
              <li>✓ Priority Weather Alerts</li>
            </ul>
          </div>
          <Button variant="secondary" className="w-full text-[12px]" onClick={() => onEnroll?.('standard')}>
            Offer Standard
          </Button>
        </Card>

        {/* Premium Tier */}
        <Card className="p-4 border-2 border-brand-gold relative flex flex-col justify-between">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 font-bold flex items-center gap-1 bg-brand-gold text-bg-app rounded-full"><Star className="w-3 h-3" /> Most Popular</span>
          </div>
          <div className="mt-2">
            <h4 className="text-[14px] font-bold text-text-primary mb-1">Premium Care</h4>
            <p className="text-[20px] font-black text-brand-gold mb-3">$39<span className="text-[12px] text-brand-gold/60 font-normal">/mo</span></p>
            <ul className="text-[12px] text-text-secondary space-y-2 mb-4">
              <li>✓ Everything in Standard</li>
              <li>✓ Priority Post-Storm Dispatch</li>
              <li>✓ Annual Gutter Cleaning</li>
              <li>✓ 10% Off Minor Repairs</li>
            </ul>
          </div>
          <Button variant="primary" className="w-full text-[12px] bg-brand-gold hover:bg-brand-goldHighlight text-bg-app" onClick={() => onEnroll?.('premium')}>
            Offer Premium
          </Button>
        </Card>

        {/* Elite Tier */}
        <Card className="p-4 border border-border-subtle flex flex-col justify-between">
          <div>
            <h4 className="text-[14px] font-bold text-text-primary mb-1">Elite Maintenance</h4>
            <p className="text-[20px] font-black text-text-primary mb-3">$89<span className="text-[12px] text-text-muted font-normal">/mo</span></p>
            <ul className="text-[12px] text-text-secondary space-y-2 mb-4">
              <li>✓ Everything in Premium</li>
              <li>✓ Free Minor Shingle Replacements</li>
              <li>✓ Guaranteed 24hr Emergency Tarping</li>
              <li>✓ Free Drone Thermal Scan</li>
            </ul>
          </div>
          <Button variant="secondary" className="w-full text-[12px]" onClick={() => onEnroll?.('elite')}>
            Offer Elite
          </Button>
        </Card>
      </div>
    </div>
  )
}

