import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui'
import { GraduationCap } from 'lucide-react'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'

export default function MorePage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6 pb-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight">More</h1>
        <p className="text-sm text-text-secondary mt-1">Settings and additional resources.</p>
      </div>

      <div className="space-y-3">
        <div onClick={() => navigate('/training')} className="cursor-pointer"><Card className="hover:bg-bg-elevated transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-brand-500/10 p-3 rounded-xl">
              <GraduationCap className="w-6 h-6 text-brand-primary" />
            </div>
            <div>
              <h3 className="font-bold text-[15px]">Training Simulator</h3>
              <p className="text-[13px] text-text-secondary mt-0.5">Interactive guided walkthrough</p>
            </div>
          </div>
        </Card></div>
      </div>
      <div className="grid gap-4 mt-8 opacity-75">
        <AccountPanel />
        <SyncPanel />

        {/* Build Identity */}
        <Card className="p-4 bg-bg-app border-border-subtle text-xs text-text-muted font-mono">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between"><span>App Version</span><span>1.0.0</span></div>
            <div className="flex justify-between"><span>Environment</span><span className="text-status-success">PRODUCTION</span></div>
            <div className="flex justify-between"><span>Schema Version</span><span>20260926</span></div>
          </div>
        </Card>
      </div>
    </div>
  )
}


