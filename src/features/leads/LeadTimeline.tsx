import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, SectionTitle } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import type { ContactEvent } from '@/features/leads/pipeline'
import type { LeadAttachment } from '@/features/leads/lead-store'
import { readUnifiedTimeline, type TimelineItem } from './timeline-store'

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  activity: 'Activity',
  attachment: 'Media',
  appointment: 'Appointment',
  inspection: 'Inspection',
  estimate: 'Estimate',
  roofr: 'Roofr',
  assignment: 'Assignment',
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function LocalMedia({ attachment }: { attachment: LeadAttachment }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob =
      attachment.kind === 'photo' ? (attachment.thumbnail ?? attachment.blob) : attachment.blob
    const made = URL.createObjectURL(blob)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [attachment])

  if (!url) return null
  if (attachment.kind === 'photo') {
    return (
      <img
        src={url}
        alt="Lead timeline attachment"
        className="mt-2 h-28 w-full rounded-lg object-cover ring-1 ring-white/10"
      />
    )
  }
  return <audio controls src={url} className="mt-2 h-9 w-full" />
}

export default function LeadTimeline({
  leadId,
  history,
  attachments,
}: {
  leadId: string
  history: readonly ContactEvent[]
  attachments: readonly LeadAttachment[]
}) {
  const { membership } = useSession()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void readUnifiedTimeline({
      organizationId: membership?.organizationId ?? null,
      leadClientId: leadId,
      localHistory: history,
      localAttachments: attachments,
    }).then((result) => {
      if (cancelled) return
      setItems(result.items)
      setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [attachments, history, leadId, membership?.organizationId])

  const localById = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment])),
    [attachments],
  )

  return (
    <>
      <SectionTitle hint={`${items.length} events`}>TIMELINE</SectionTitle>
      {error && (
        <p className="mb-2 rounded-xl bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-100/75 ring-1 ring-amber-500/20">
          The server timeline is only partially available: {error}. Local field history is still
          shown below.
        </p>
      )}
      {items.length === 0 ? (
        <Empty
          title="Nothing recorded yet"
          body="Knocks, calls, notes, media, appointments, inspections, estimates and Roofr events will appear here in chronological order."
        />
      ) : (
        <Card>
          <ol className="space-y-3">
            {items.map((item) => {
              const attachment =
                item.localAttachmentId === undefined
                  ? null
                  : (localById.get(item.localAttachmentId) ?? null)
              return (
                <li key={item.id} className="border-l-2 border-white/10 pl-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[12.5px] font-semibold text-white/80">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-white/30">
                        {when(item.at)} · {KIND_LABEL[item.kind]}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[9px] uppercase tracking-wider ring-1 ${
                        item.state === 'server'
                          ? 'bg-emerald-500/8 text-emerald-300/80 ring-emerald-500/20'
                          : 'bg-amber-500/8 text-amber-200/70 ring-amber-500/20'
                      }`}
                    >
                      {item.state === 'server' ? 'server' : 'device'}
                    </span>
                  </div>

                  {item.detail && (
                    <p className="mt-1 break-words text-[12px] leading-relaxed text-white/55">
                      {item.detail}
                    </p>
                  )}

                  {attachment && <LocalMedia attachment={attachment} />}

                  {item.source === 'roofr' && (
                    <p className="mt-1 text-[9.5px] uppercase tracking-wider text-white/20">
                      Source: Roofr event
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </Card>
      )}
      <p className="mt-2 text-[10.5px] leading-relaxed text-white/25">
        Device entries remain visible before sync. When the same client ID is read back from the
        server, the timeline marks that event server-backed instead of showing a duplicate.
      </p>
    </>
  )
}
