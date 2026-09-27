import { useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'

export interface SoldJobHandoffGateProps {
  onConfirm: () => void
  onCancel: () => void
}

export function SoldJobHandoffGate({ onConfirm, onCancel }: SoldJobHandoffGateProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [contract, setContract] = useState(false)
  const [measurements, setMeasurements] = useState(false)
  const [scope, setScope] = useState(false)
  const [color, setColor] = useState(false)
  const [photos, setPhotos] = useState(false)

  const missing = []
  if (!confirmed) missing.push("Customer not confirmed")
  if (!contract) missing.push("Contract not signed")
  if (!measurements) missing.push("Measurements missing")
  if (!scope) missing.push("Scope incomplete")
  if (!color) missing.push("Color not selected")
  if (!photos) missing.push("Photos incomplete")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <Card className="w-full max-w-md bg-bg-app shadow-xl">
        <SectionTitle>Sold-Job Handoff Gate</SectionTitle>
        <p className="mt-2 text-[13px] text-text-secondary">
          Verify the following before moving to production:
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="size-4" />
            Customer confirmed
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={contract} onChange={e => setContract(e.target.checked)} className="size-4" />
            Contract signed
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={measurements} onChange={e => setMeasurements(e.target.checked)} className="size-4" />
            Measurements
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={scope} onChange={e => setScope(e.target.checked)} className="size-4" />
            Scope complete
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={color} onChange={e => setColor(e.target.checked)} className="size-4" />
            Color selected
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} className="size-4" />
            Photos complete
          </label>
        </div>
        
        <div className="mt-6">
          {missing.length > 0 && (
            <p className="mb-4 text-[13px] font-semibold text-warning-highlight">
              Handoff blocked - {missing.join(', ')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button disabled={missing.length > 0} onClick={onConfirm}>Proceed to Production</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
