import { PageHeader } from '@/components/ui'
import { StormCommandCenter } from '@/features/manager/StormCommandCenter'

export default function StormOSPage() {
  return (
    <div className="mx-auto max-w-screen-xl pb-24 pt-6 animate-in fade-in duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader title="Storm OS" description="Real-time weather tracking and storm activity." />
        <div className="mt-6">
          <StormCommandCenter />
        </div>
      </div>
    </div>
  )
}
