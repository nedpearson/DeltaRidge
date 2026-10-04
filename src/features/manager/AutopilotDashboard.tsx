import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { Button, Card, SectionTitle, Empty } from '@/components/ui'
import { Bot, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

type EscrowedConversation = {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_address: string;
  status: 'active' | 'escalated' | 'resolved';
  requires_human: boolean;
  escalation_reason?: string;
  last_message_at: string;
}

export function AutopilotDashboard() {
  const [conversations, setConversations] = useState<EscrowedConversation[]>([])
  const [metrics, setMetrics] = useState({
    active: 0,
    booked: 0,
    escalated: 0,
  })
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      try {
        const [
          { data: convos },
          { data: leadsData }
        ] = await Promise.all([
          supabase.from('conversations').select('*'),
          supabase.from('leads').select('id, contact_name, address, status')
        ])

        const allConvos = convos || []
        const active = allConvos.filter(c => c.status === 'active').length
        const escalated = allConvos.filter(c => c.requires_human || c.status === 'escalated').length
        const booked = leadsData?.filter(l => l.status === 'appointment_set').length || 0

        setMetrics({ active, booked, escalated })

        const exceptions = allConvos
          .filter(c => c.requires_human || c.status === 'escalated')
          .map(c => {
            const lead = leadsData?.find(l => l.id === c.lead_id)
            return {
              id: c.id,
              lead_id: c.lead_id,
              lead_name: lead?.contact_name || 'Unknown',
              lead_address: lead?.address || 'Unknown Address',
              status: c.status,
              requires_human: c.requires_human,
              escalation_reason: c.escalation_reason || 'Human Attention Required',
              last_message_at: c.last_message_at || c.created_at,
            }
          })
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())

        if (mounted) {
          setConversations(exceptions)
          setLoading(false)
        }
      } catch (err) {
        console.error("Error fetching autopilot data:", err)
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  if (loading) {
    return <p className="text-[13px] text-text-secondary p-4 text-center">Loading AI Autopilot...</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-brand-primary/5 border-brand-400">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="text-brand-500" size={18} />
            <span className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">AI Conversations Active</span>
          </div>
          <p className="text-3xl font-display text-text-primary">{metrics.active}</p>
        </Card>
        <Card className="bg-status-success/5 border-status-success/30">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="text-status-success" size={18} />
            <span className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">Appointments Booked Autonomously</span>
          </div>
          <p className="text-3xl font-display text-text-primary">{metrics.booked}</p>
        </Card>
        <Card className="bg-warning-surface border-warning-border">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="text-status-warning" size={18} />
            <span className="text-[11px] uppercase font-bold tracking-widest text-text-secondary">Human Intervention Requested</span>
          </div>
          <p className="text-3xl font-display text-text-primary">{metrics.escalated}</p>
        </Card>
      </div>

      <div>
        <SectionTitle>EXCEPTION QUEUE</SectionTitle>
        {conversations.length === 0 ? (
          <Empty
            title="All Clear"
            body="No conversations currently require human intervention. AI is handling all active threads."
          />
        ) : (
          <div className="space-y-3 mt-3">
            {conversations.map(c => (
              <Card key={c.id} className="border-l-4 border-l-status-warning flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={14} className="text-status-warning" />
                    <h3 className="text-[14px] font-bold text-text-primary">{c.lead_name}</h3>
                    <span className="text-[12px] text-text-secondary">&bull; {c.lead_address}</span>
                  </div>
                  <p className="text-[13px] text-text-secondary">
                    <span className="font-semibold">Reason:</span> {c.escalation_reason}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Last active: {new Date(c.last_message_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <Button variant="secondary" onClick={() => navigate(`/lead/${c.lead_id}`)}>
                    Review Thread <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
