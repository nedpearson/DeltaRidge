import { useState } from 'react'
import { Card, SectionTitle, Button } from '@/components/ui'

export type CommunicationType = 'call' | 'sms' | 'email' | 'note' | 'appointment'

export interface CommunicationEvent {
  id: string
  type: CommunicationType
  timestamp: string
  author?: string
  content: string
  direction?: 'inbound' | 'outbound'
}

export function CommunicationHub({ events }: { events: CommunicationEvent[] }) {
  const [filter, setFilter] = useState<CommunicationType | 'all'>('all')
  const [composeType, setComposeType] = useState<'note' | 'sms' | 'email'>('note')
  const [composeText, setComposeText] = useState('')

  const filteredEvents = events.filter(e => filter === 'all' || e.type === filter)

  const getIcon = (type: CommunicationType) => {
    switch (type) {
      case 'call': return '📞'
      case 'sms': return '💬'
      case 'email': return '✉️'
      case 'note': return '📝'
      case 'appointment': return '📅'
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-app">
      <div className="p-4 border-b border-border-subtle bg-bg-elevated">
        <SectionTitle>Communication Hub</SectionTitle>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {(['all', 'note', 'sms', 'call', 'email', 'appointment'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors ${
                filter === t ? 'bg-brand-gold text-bg-app' : 'bg-bg-app text-text-secondary border border-border-subtle hover:border-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {filteredEvents.length === 0 ? (
          <p className="text-sm text-text-secondary text-center py-8">No communications match the selected filter.</p>
        ) : (
          filteredEvents.map(event => (
            <div key={event.id} className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-sm border border-border-subtle">
                {getIcon(event.type)}
              </div>
              <Card className="flex-1 p-3">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-semibold text-text-primary capitalize">
                    {event.type} {event.direction ? `(${event.direction})` : ''}
                  </span>
                  <span className="text-xs text-text-secondary">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
                {event.author && <p className="text-xs text-text-secondary mb-1">By {event.author}</p>}
                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{event.content}</p>
              </Card>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-border-subtle bg-bg-elevated">
        <div className="flex gap-2 mb-2">
          {(['note', 'sms', 'email'] as const).map(t => (
            <button
              key={t}
              onClick={() => setComposeType(t)}
              className={`text-xs px-2 py-1 font-medium rounded ${composeType === t ? 'bg-bg-app text-brand-gold' : 'text-text-secondary'}`}
            >
              New {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <textarea
          className="w-full bg-bg-app border border-border-subtle rounded p-2 text-sm text-text-primary focus:outline-none focus:border-brand-gold resize-none"
          rows={3}
          placeholder={`Write a ${composeType}...`}
          value={composeText}
          onChange={e => setComposeText(e.target.value)}
        />
        <div className="flex justify-end mt-2">
          <Button variant="primary" disabled={!composeText.trim()} onClick={() => setComposeText('')}>
            {composeType === 'note' ? 'Save Note' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}
