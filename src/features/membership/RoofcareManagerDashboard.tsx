import { Card } from '@/components/ui'
import { AlertCircle } from 'lucide-react'

export default function RoofcareManagerDashboard() {
  return (
    <div className="space-y-4">
      <Card className="p-4 bg-bg-app border border-border-subtle flex flex-col items-center justify-center text-center py-10">
        <AlertCircle className="w-8 h-8 text-status-warning mb-3" />
        <h3 className="text-[14px] font-bold text-text-primary">RoofCare Metrics Unavailable</h3>
        <p className="text-[12px] text-text-secondary mt-2 max-w-sm leading-relaxed">
          The RoofCare database schema has been deployed, but production metric aggregation is not yet wired. No measured zeros will be shown until objective data is queried.
        </p>
      </Card>
    </div>
  )
}
