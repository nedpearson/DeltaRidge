import { Card, SectionTitle } from '@/components/ui'
import { ShieldCheck, Calendar, Users, TrendingUp } from 'lucide-react'

export default function RoofcareManagerDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col items-center justify-center text-center">
          <ShieldCheck className="w-6 h-6 text-brand-gold mb-2" />
          <p className="text-[24px] font-black text-text-primary">0</p>
          <p className="text-[12px] text-text-secondary uppercase tracking-wider font-bold">Active Members</p>
        </Card>
        
        <Card className="p-4 flex flex-col items-center justify-center text-center">
          <TrendingUp className="w-6 h-6 text-brand-success mb-2" />
          <p className="text-[24px] font-black text-text-primary">$0</p>
          <p className="text-[12px] text-text-secondary uppercase tracking-wider font-bold">Annual Recur. Rev</p>
        </Card>

        <Card className="p-4 flex flex-col items-center justify-center text-center">
          <Calendar className="w-6 h-6 text-brand-warning mb-2" />
          <p className="text-[24px] font-black text-text-primary">0</p>
          <p className="text-[12px] text-text-secondary uppercase tracking-wider font-bold">Pending Annual Inspections</p>
        </Card>

        <Card className="p-4 flex flex-col items-center justify-center text-center">
          <Users className="w-6 h-6 text-brand-primary mb-2" />
          <p className="text-[24px] font-black text-text-primary">0%</p>
          <p className="text-[12px] text-text-secondary uppercase tracking-wider font-bold">Conversion Rate (Last 30d)</p>
        </Card>
      </div>

      <div>
        <div className="mb-3"><SectionTitle>UPCOMING FULFILLMENT (ANNUAL INSPECTIONS)</SectionTitle></div>
        <Card className="p-8 text-center border-dashed border-2 border-border-subtle bg-transparent">
          <p className="text-[14px] text-text-secondary">
            No scheduled RoofCare services or inspections for the next 30 days.
          </p>
        </Card>
      </div>
    </div>
  )
}
