import { useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'

export default function CampaignsTab() {
  const [isCreating, setIsCreating] = useState(false)
  
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <SectionTitle hint="Targeted geographic efforts">
          Active Campaigns
        </SectionTitle>
        {!isCreating && (
          <Button variant="ghost" onClick={() => setIsCreating(true)}>
            + New Campaign
          </Button>
        )}
      </div>

      {isCreating ? (
        <CreateCampaignForm onCancel={() => setIsCreating(false)} />
      ) : (
        <div className="space-y-4">
          <CampaignCard 
            name="Oak Hills Storm Response"
            status="Active"
            dateRange="Sep 25 - Oct 10"
            opportunityCount={31}
            coverageProgress={19}
            dailyTarget={15}
            estGp="$18,500"
          />
          <CampaignCard 
            name="Meadow Ridge Referrals"
            status="Completed"
            dateRange="Aug 1 - Aug 30"
            opportunityCount={84}
            coverageProgress={100}
            dailyTarget={10}
            estGp="$54,200"
          />
        </div>
      )}

      <div className="mt-8">
        <SectionTitle hint="Territory intelligence insights">
          Territory Intelligence
        </SectionTitle>
        <Card className="mt-4 bg-bg-card p-4">
          <div className="flex gap-4">
            <Button variant="secondary" className="flex-1 text-[12px] py-2 h-auto">View Untouched Opportunities</Button>
            <Button variant="secondary" className="flex-1 text-[12px] py-2 h-auto">Where Reps Stopped Yesterday</Button>
            <Button variant="primary" className="flex-1 text-[12px] py-2 h-auto">Highest-Value Neighborhood</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function CampaignCard({ 
  name, status, dateRange, opportunityCount, coverageProgress, dailyTarget, estGp 
}: { 
  name: string, status: string, dateRange: string, opportunityCount: number, coverageProgress: number, dailyTarget: number, estGp: string 
}) {
  return (
    <Card className="bg-bg-card p-4 border border-border-subtle">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-[15px] font-bold text-text-primary">{name}</h3>
          <p className="text-[12px] text-text-secondary mt-0.5">{dateRange}</p>
        </div>
        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${status === 'Active' ? 'bg-status-success/20 text-status-success' : 'bg-border-subtle text-text-secondary'}`}>
          {status}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <span className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Opportunities</span>
          <span className="text-[14px] font-bold text-text-primary">{opportunityCount} homes</span>
        </div>
        <div>
          <span className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Daily Target</span>
          <span className="text-[14px] font-bold text-text-primary">{dailyTarget} doors</span>
        </div>
        <div>
          <span className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Coverage</span>
          <span className="text-[14px] font-bold text-brand-500">{coverageProgress}%</span>
        </div>
        <div>
          <span className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Estimated GP</span>
          <span className="text-[14px] font-bold text-status-success">{estGp}</span>
        </div>
      </div>

      <div className="w-full bg-bg-app rounded-full h-1.5 overflow-hidden">
        <div className="bg-brand-500 h-full" style={{ width: `${coverageProgress}%` }} />
      </div>
      
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="text-[11px] h-8">View Map</Button>
        <Button variant="secondary" className="text-[11px] h-8">Assign Reps</Button>
      </div>
    </Card>
  )
}

function CreateCampaignForm({ onCancel }: { onCancel: () => void }) {
  return (
    <Card className="p-4 space-y-4 border border-brand-500/30">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Campaign Name</label>
        <input 
          type="text" 
          className="w-full bg-bg-app border border-border-subtle rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-brand-500"
          placeholder="e.g. Oak Hills Storm Response"
        />
      </div>
      
      <div className="bg-bg-app border border-border-subtle p-8 rounded-lg flex items-center justify-center text-text-secondary text-[13px]">
        [ EagleView Map Placeholder for Drawing Territory ]
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary">Create Campaign</Button>
      </div>
    </Card>
  )
}
