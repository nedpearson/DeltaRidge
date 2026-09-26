import { Card } from '@/components/ui'
import { useRevenueLeakage } from './useRevenueLeakage'
import { AlertCircle, ArrowRight } from 'lucide-react'

export default function RevenueLeakagePanel() {
  const { data, loading } = useRevenueLeakage()

  if (loading) {
    return <Card className="p-4 text-center text-text-secondary text-sm">Calculating leakage points...</Card>
  }

  const totalLeakage = data.reduce((acc, point) => acc + point.count, 0)

  if (totalLeakage === 0) {
    return (
      <Card className="p-4 flex items-center gap-3 bg-brand-success/10 border border-brand-success/20">
        <div className="w-2 h-2 rounded-full bg-brand-success shrink-0" />
        <p className="text-[13px] text-text-primary">No severe revenue leakage detected across the funnel.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="p-4 bg-brand-warning/10 border border-brand-warning/20">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-brand-warning shrink-0" />
          <div>
            <h4 className="text-[14px] font-bold text-text-primary">Funnel Leakage Detected</h4>
            <p className="text-[12px] text-text-secondary mt-1">
              There are {totalLeakage} opportunities stalled at critical transition points in your sales pipeline.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-2">
        {data.filter(point => point.count > 0).map((point) => (
          <Card key={point.id} className="p-3 flex items-center justify-between hover:bg-bg-elevated cursor-pointer transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-bg-app flex items-center justify-center font-bold text-[14px] text-brand-warning">
                {point.count}
              </div>
              <div>
                <p className="text-[13.5px] font-bold text-text-primary">{point.label}</p>
                <p className="text-[11.5px] text-text-secondary mt-0.5">{point.description}</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-text-muted" />
          </Card>
        ))}
      </div>
    </div>
  )
}
