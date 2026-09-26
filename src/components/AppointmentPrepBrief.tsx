import { Card, SectionTitle } from '@/components/ui'

export interface AppointmentPrepData {
  homeowner: string
  contactPhone: string
  address: string
  roofAge: string
  stormEvidence: string[]
  eagleViewAvailable: boolean
  previousInteractions: string[]
  toVerify: string[]
}

export function AppointmentPrepBrief({ data, onClose }: { data: AppointmentPrepData; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full bg-bg-app">
      <div className="flex items-center justify-between p-4 border-b border-border-subtle bg-bg-elevated">
        <h2 className="text-lg font-semibold">Prep Brief: {data.homeowner}</h2>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-sm font-medium">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <SectionTitle>KNOWN</SectionTitle>
          <div className="mt-3 space-y-3">
            <Card className="border-l-4 border-brand-gold">
              <h3 className="text-xs uppercase tracking-wide text-text-secondary font-semibold">Contact & Property</h3>
              <p className="mt-1 text-sm"><span className="font-medium text-text-primary">Name:</span> {data.homeowner}</p>
              <p className="text-sm"><span className="font-medium text-text-primary">Phone:</span> {data.contactPhone}</p>
              <p className="text-sm"><span className="font-medium text-text-primary">Address:</span> {data.address}</p>
            </Card>

            <Card className="border-l-4 border-brand-gold">
              <h3 className="text-xs uppercase tracking-wide text-text-secondary font-semibold">Property Intelligence</h3>
              <p className="mt-1 text-sm"><span className="font-medium text-text-primary">Estimated Roof Age:</span> {data.roofAge}</p>
              <p className="text-sm"><span className="font-medium text-text-primary">EagleView Imagery:</span> {data.eagleViewAvailable ? 'Ready' : 'Pending'}</p>
              <div className="mt-2">
                <span className="font-medium text-sm text-text-primary">Storm Evidence:</span>
                <ul className="list-disc list-inside text-sm text-text-secondary mt-1">
                  {data.stormEvidence.map((ev, i) => <li key={i}>{ev}</li>)}
                </ul>
              </div>
            </Card>

            <Card className="border-l-4 border-brand-gold">
              <h3 className="text-xs uppercase tracking-wide text-text-secondary font-semibold">Previous Interactions</h3>
              <ul className="mt-2 space-y-2">
                {data.previousInteractions.map((interaction, i) => (
                  <li key={i} className="text-sm text-text-secondary pb-2 border-b border-border-subtle last:border-0 last:pb-0">
                    {interaction}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <div>
          <SectionTitle>VERIFY ON SITE</SectionTitle>
          <div className="mt-3">
            <Card className="border-l-4 border-status-warning/70 bg-warning-surface">
              <ul className="space-y-2">
                {data.toVerify.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="mt-1 w-3 h-3 rounded-full border-2 border-status-warning/70 shrink-0" />
                    <span className="text-sm text-text-primary">{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
