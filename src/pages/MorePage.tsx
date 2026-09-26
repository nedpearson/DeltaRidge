import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui'
import { GraduationCap } from 'lucide-react'

export default function MorePage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6 pb-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight">More</h1>
        <p className="text-sm text-text-secondary mt-1">Settings and additional resources.</p>
      </div>

      <div className="space-y-3">
        <Card className="cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/training')}>
          <div className="flex items-center gap-4">
            <div className="bg-brand-500/10 p-3 rounded-xl">
              <GraduationCap className="w-6 h-6 text-brand-primary" />
            </div>
            <div>
              <h3 className="font-bold text-[15px]">Training Simulator</h3>
              <p className="text-[13px] text-text-secondary mt-0.5">Interactive guided walkthrough</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
