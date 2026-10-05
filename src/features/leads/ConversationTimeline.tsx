/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
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
        const { data, error: _error } = await supabase
          .from('omnichannel_timeline')
          .select('*')
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false })
          
        const timeline: TimelineEvent[] = []

        if (data) {
          data.forEach((row: any) => {
            let type: TimelineEvent['type'] = 'REP NOTE'
            if (row.event_type === 'message') {
              type = row.subtype === 'email' ? 'EMAIL' : 'TEXT'
            } else if (row.event_type === 'call') {
              type = 'CALL'
            } else if (row.event_type === 'activity') {
               type = 'REP NOTE'
               if (row.subtype === 'storm') type = 'STORM EVENT'
               if (row.subtype === 'inspection') type = 'INSPECTION'
            }

            timeline.push({
              id: row.id,
              type,
              timestamp: row.created_at,
              content: row.content || row.notes || row.description,
              isAi: row.ai_generated || false,
              authorName: row.user_name || row.author || row.direction
            })
          })
        }

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

