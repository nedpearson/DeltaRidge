import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { Card, Empty } from '@/components/ui'
import { Bot, User } from 'lucide-react'

type TimelineEvent = {
  id: string;
  type: 'TEXT' | 'CALL' | 'EMAIL' | 'REP NOTE' | 'STORM EVENT' | 'INSPECTION';
  timestamp: string;
  content?: string;
  isAi?: boolean;
  authorName?: string;
  metadata?: any;
}

export function ConversationTimeline({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

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
          _convoRes,
          msgRes,
          callRes,
          actRes
        ] = await Promise.all([
          supabase.from('conversations').select('*').eq('lead_id', leadId),
          supabase.from('messages').select('*').eq('lead_id', leadId),
          supabase.from('calls').select('*').eq('lead_id', leadId),
          supabase.from('activities').select('*').eq('lead_id', leadId)
        ])
        
        // const conversations = convoRes.data || [] // Unused for now but fetched for timeline context if needed
        const messages = msgRes.data || []
        const calls = callRes.data || []
        const activities = actRes.data || []

        const timeline: TimelineEvent[] = []

        if (messages) {
          messages.forEach((m: any) => {
            timeline.push({
              id: `msg_${m.id}`,
              type: m.channel === 'email' ? 'EMAIL' : 'TEXT',
              timestamp: m.created_at || m.timestamp,
              content: m.body || m.content,
              isAi: m.is_ai || m.sender_type === 'ai',
              authorName: m.sender_name
            })
          })
        }

        if (calls) {
          calls.forEach((c: any) => {
            timeline.push({
              id: `call_${c.id}`,
              type: 'CALL',
              timestamp: c.created_at || c.timestamp,
              content: c.notes || c.summary,
              isAi: c.is_ai || c.agent_type === 'ai',
            })
          })
        }

        if (activities) {
          activities.forEach((a: any) => {
            let type: TimelineEvent['type'] = 'REP NOTE'
            if (a.type === 'storm') type = 'STORM EVENT'
            if (a.type === 'inspection') type = 'INSPECTION'
            
            timeline.push({
              id: `act_${a.id}`,
              type,
              timestamp: a.created_at || a.timestamp,
              content: a.description || a.note,
              authorName: a.user_name || a.author
            })
          })
        }

        timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        
        if (mounted) {
          setEvents(timeline)
          setLoading(false)
        }
      } catch (err) {
        console.error("Error fetching timeline:", err)
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [leadId])

  if (loading) {
    return <p className="text-[13px] text-text-secondary p-4 text-center">Loading timeline...</p>
  }

  if (events.length === 0) {
    return (
      <Empty
        title="No timeline events"
        body="Any conversations, messages, or activities will appear here."
      />
    )
  }

  return (
    <Card className="mt-2">
      <ol className="space-y-4">
        {events.map((evt) => (
          <li key={evt.id} className="border-l-2 border-border-subtle pl-4 relative">
            <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-border-subtle" />
            <div className="flex justify-between items-start mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-text-primary tracking-wider">
                  {evt.type}
                </span>
                {evt.isAi && (
                  <span className="bg-brand-primary/20 text-brand-500 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">
                    <Bot size={12} /> AI Agent
                  </span>
                )}
                {!evt.isAi && evt.authorName && (
                  <span className="bg-bg-elevated text-text-secondary flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">
                    <User size={12} /> {evt.authorName}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-text-secondary">
                {evt.timestamp ? new Date(evt.timestamp).toLocaleString() : 'Unknown date'}
              </span>
            </div>
            {evt.content && (
              <p className="text-[13px] text-text-secondary leading-relaxed bg-bg-app rounded-lg p-2.5 mt-1 border border-border-subtle">
                {evt.content}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
