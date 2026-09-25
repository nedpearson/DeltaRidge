import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Empty, SectionTitle } from '@/components/ui'
import { listInspections, type LocalInspection } from '@/lib/db'
import { inspectionTitle } from './HomePage'

export default function InspectionsPage() {
  const [inspections, setInspections] = useState<LocalInspection[]>([])
  useEffect(() => {
    void listInspections().then(setInspections)
  }, [])

  return (
    <div>
      <SectionTitle hint={`${inspections.length} on this device`}>ALL INSPECTIONS</SectionTitle>
      {inspections.length === 0 ? (
        <Empty title="Nothing captured yet" body="Inspections you start will appear here, and stay here whether or not you have signal." />
      ) : (
        <div className="space-y-2">
          {inspections.map((i) => (
            <Link key={i.id} to={`/inspection/${i.id}`} className="block">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">{inspectionTitle(i)}</p>
                    <p className="mt-0.5 truncate text-[12px] text-[var(--color-ink)]/">
                      {[i.city, i.parish && `${i.parish} Parish`].filter(Boolean).join(' · ') || 'No address details'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
                      i.status === 'complete'
                        ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25'
                        : 'bg-slate-100 hover:bg-slate-200 text-[var(--color-ink)]/ ring-slate-200'
                    }`}
                  >
                    {i.status === 'complete' ? 'Complete' : 'Open'}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
