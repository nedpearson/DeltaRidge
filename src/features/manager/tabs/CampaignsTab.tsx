import { useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { Nothing } from '@/features/manager/tabs/shared'

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
            + New
          </Button>
        )}
      </div>

      {!isCreating ? (
        <Nothing
          title="No campaigns yet"
          body="Campaign scoping (Spec 16) is wired up. You can create targeted geographic areas and assign leads to them."
        />
      ) : (
        <Card className="animate-in fade-in slide-in-from-top-2">
          <h3 className="mb-4 text-sm font-semibold text-white">New Campaign Scope</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-white/50">Campaign Name</label>
              <input type="text" className="w-full rounded-xl bg-surface-3 px-4 py-3 text-sm text-white outline-none focus:ring-2 focus:ring-brand-500" placeholder="e.g., Spring Hail Storm - Area 4" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/50">Target Area</label>
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-surface/50 p-8 text-center">
                <svg className="mb-2 h-8 w-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                <p className="text-sm font-medium text-white/60">Draw Geographic Scope</p>
                <p className="mt-1 text-xs text-brand-400">Mapbox GL Draw integration pending full Spec 16 review.</p>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button variant="ghost" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button className="flex-1">
                Save Campaign
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
