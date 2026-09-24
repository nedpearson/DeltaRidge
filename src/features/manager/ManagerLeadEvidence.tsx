import { Button, Card, Empty, SectionTitle } from '@/components/ui'

export interface ManagerEvidenceLead {
  leadId: string
  address: string
  detail?: string
}

export default function ManagerLeadEvidence({
  title,
  hint,
  leads,
  onOpenLead,
  onClose,
}: {
  title: string
  hint?: string
  leads: readonly ManagerEvidenceLead[]
  onOpenLead: (leadId: string) => void
  onClose?: () => void
}) {
  const unique = [...new Map(leads.map((lead) => [lead.leadId, lead])).values()]

  return (
    <div className="space-y-2">
      <SectionTitle hint={hint ?? `${unique.length} record${unique.length === 1 ? '' : 's'}`}>
        {title}
      </SectionTitle>

      {onClose && (
        <Button variant="ghost" full onClick={onClose}>
          Close supporting records
        </Button>
      )}

      {unique.length === 0 ? (
        <Empty
          title="No supporting records"
          body="There are no lead records behind this figure in the current reporting window."
        />
      ) : (
        unique.map((lead) => (
          <Card key={lead.leadId}>
            <p className="break-words text-[13.5px] font-semibold">{lead.address || 'Address unavailable'}</p>
            {lead.detail && (
              <p className="mt-1 break-words text-[11.5px] leading-relaxed text-white/40">
                {lead.detail}
              </p>
            )}
            <Button variant="secondary" full className="mt-2.5" onClick={() => onOpenLead(lead.leadId)}>
              Open Lead 360
            </Button>
          </Card>
        ))
      )}
    </div>
  )
}
