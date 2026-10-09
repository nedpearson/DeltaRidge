import { useState, useEffect } from 'react'
import { Mic, Send, X, Bot } from 'lucide-react'
import { useLocation } from 'react-router-dom'

export function AIAssistant({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<{ id: string; role: string; text: string }[]>([])

  useEffect(() => {
    if (isOpen) {
      let initialSuggestion = 'How can I help you today?'
      const path = location.pathname
      
      if (path.startsWith('/leads/')) {
        initialSuggestion = "Summarize this lead's storm exposure."
      } else if (path.startsWith('/settings')) {
        initialSuggestion = 'Check AI automation readiness.'
      }

      setMessages([{ id: Date.now().toString(), role: 'assistant', text: initialSuggestion }])
    }
  }, [isOpen, location.pathname])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: query }])
    setQuery('')
    
    setTimeout(() => {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', text: 'I am looking into that for you.' }])
    }, 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex h-[80vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:h-[600px] sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-full bg-brand-primary text-white">
              <Bot size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">AI Assistant</h2>
              <p className="text-xs text-gray-500">Voice-enabled</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === 'user' ? 'bg-brand-primary text-white rounded-br-none' : 'bg-gray-100 text-gray-900 rounded-bl-none'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 p-4">
          <form onSubmit={handleSubmit} className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 p-1 pl-4 focus-within:border-brand-primary focus-within:ring-1 focus-within:ring-brand-primary">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything..."
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <button type="button" className="grid size-8 place-items-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700">
              <Mic size={18} />
            </button>
            <button type="submit" disabled={!query.trim()} className="grid size-8 place-items-center rounded-full bg-brand-primary text-white disabled:opacity-50">
              <Send size={16} className="ml-[-2px]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
