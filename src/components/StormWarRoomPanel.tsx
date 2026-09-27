import { useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'

export function StormWarRoomPanel() {
  const [deploying, setDeploying] = useState(false)

  return (
    <div className="space-y-4">
      <Card className="border-red-500/30 bg-gradient-to-r from-red-900/20 to-bg-app">
        <h2 className="mb-2 text-xl font-bold text-red-400">ACTIVE STORM: May 8 Hail (Baton Rouge)</h2>
        <div className="mb-4 grid grid-cols-3 gap-4">
          <div>
            <div className="text-2xl font-bold text-text-primary">1,204</div>
            <div className="text-xs uppercase text-text-secondary">Affected Properties</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-text-primary">342</div>
            <div className="text-xs uppercase text-text-secondary">High-Opportunity</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-brand-primary">87</div>
            <div className="text-xs uppercase text-text-secondary">Existing Customers</div>
          </div>
        </div>
        {!deploying ? (
          <Button variant="danger" onClick={() => setDeploying(true)}>Deploy Team</Button>
        ) : (
          <div className="mt-4 border-t border-border-subtle pt-4">
            <SectionTitle>PROPOSED ASSIGNMENTS</SectionTitle>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-elevated p-3">
                <div>
                  <div className="font-bold">Jake</div>
                  <div className="text-xs text-text-secondary">28 properties (Highest close rate in 70808)</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => alert("Assigned to Jake!")}>Assign</Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-elevated p-3">
                <div>
                  <div className="font-bold">Mike</div>
                  <div className="text-xs text-text-secondary">31 properties (Existing relationships in neighborhood)</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => alert("Assigned to Mike!")}>Assign</Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-elevated p-3">
                <div>
                  <div className="font-bold">Sarah</div>
                  <div className="text-xs text-text-secondary">25 properties (Best performance with premium upgrades)</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => alert("Assigned to Sarah!")}>Assign</Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
