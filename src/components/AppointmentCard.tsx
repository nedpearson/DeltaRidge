import { useState } from 'react'
import { Card, Button } from '@/components/ui'
import { AppointmentPrepBrief, type AppointmentPrepData } from './AppointmentPrepBrief'

export interface AppointmentProps {
  id: string
  homeowner: string
  address: string
  time: string
  distanceMiles: number
  prepStatus: 'ready' | 'needs_prep'
  confirmationStatus: 'confirmed' | 'unconfirmed' | 'rescheduled'
  prepData: AppointmentPrepData
}

export function AppointmentCard({ appointment }: { appointment: AppointmentProps }) {
  const [showBrief, setShowBrief] = useState(false)

  return (
    <>
      <Card className="flex flex-col gap-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-bold text-text-primary">{appointment.homeowner}</h3>
            <p className="text-sm text-text-secondary">{appointment.address}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-bold text-text-primary">{appointment.time}</p>
            <p className="text-xs text-text-secondary">{appointment.distanceMiles} mi away</p>
          </div>
        </div>

        <div className="flex gap-2">
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${appointment.prepStatus === 'ready' ? 'bg-status-success/10 text-status-success' : 'bg-status-warning/10 text-status-warning'}`}>
            Prep: {appointment.prepStatus === 'ready' ? 'Ready' : 'Needs Prep'}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${appointment.confirmationStatus === 'confirmed' ? 'bg-status-success/10 text-status-success' : 'bg-bg-elevated text-text-secondary'}`}>
            {appointment.confirmationStatus.charAt(0).toUpperCase() + appointment.confirmationStatus.slice(1)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-border-subtle">
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => {}}>
            Navigate
          </Button>
          <Button variant="primary" className="text-xs py-1.5" onClick={() => setShowBrief(true)}>
            Open Brief
          </Button>
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => {}}>
            Call
          </Button>
          <Button variant="secondary" className="text-xs py-1.5" onClick={() => {}}>
            Reschedule
          </Button>
        </div>
      </Card>

      {showBrief && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="w-full max-w-md h-full bg-bg-app shadow-xl animate-in slide-in-from-right">
            <AppointmentPrepBrief data={appointment.prepData} onClose={() => setShowBrief(false)} />
          </div>
        </div>
      )}
    </>
  )
}
