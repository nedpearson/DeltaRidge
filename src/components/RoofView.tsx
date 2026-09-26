import { Button } from '@/components/ui'

export default function RoofView({
  address,
  latitude,
  longitude
}: {
  address?: string
  latitude: number
  longitude: number
}) {
  return (
    <div className="relative w-full aspect-[2/1] min-h-[300px] bg-bg-elevated rounded-2xl overflow-hidden border border-border-subtle group flex flex-col items-center justify-center text-center p-6">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-text-primary">EagleView Imagery</h3>
        <p className="text-[13px] text-text-secondary mt-1 max-w-md">
          {address || `${latitude}, ${longitude}`}
        </p>
      </div>
      
      <div className="bg-bg-app border border-dashed border-brand-500/30 text-brand-500/80 px-4 py-3 rounded-md text-[12px] font-medium max-w-sm w-full mb-4">
        EagleView integration is wired in backend secrets but requires full Edge Function proxy for frontend delivery to prevent key leakage.
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" className="text-[12px]">Order Full Report</Button>
        <Button variant="secondary" className="text-[12px]">View Measurement 3D</Button>
      </div>

      <div className="absolute bottom-3 left-4 text-[10px] text-text-muted font-medium uppercase tracking-widest">
        EagleView Connect API
      </div>
    </div>
  )
}
