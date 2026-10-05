import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from './ui'
import { getSupabase } from '../lib/supabase'

type SearchResult = {
  result_type: 'customer' | 'property' | 'lead'
  id: string
  title: string
  subtitle: string
}

export function UniversalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }

    const fetchResults = async () => {
      setLoading(true)
      const client = getSupabase(); if (!client) return; const { data, error } = await client.rpc('universal_search', { search_query: query })
      if (!error && data) {
        setResults(data as SearchResult[])
      }
      setLoading(false)
    }

    const timeout = setTimeout(fetchResults, 300)
    return () => clearTimeout(timeout)
  }, [query])

  const handleSelect = (result: SearchResult) => {
    setOpen(false)
    if (result.result_type === 'lead') {
      navigate(`/lead/${result.id}`)
    } else if (result.result_type === 'property') {
      navigate(`/property/${result.id}`)
    }
  }

  const customers = results.filter(r => r.result_type === 'customer')
  const properties = results.filter(r => r.result_type === 'property')
  const leads = results.filter(r => r.result_type === 'lead')

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="flex items-center gap-2 py-1 px-2 text-xs text-text-secondary bg-bg-elevated hover:bg-bg-card/20 border border-border-subtle shadow-sm rounded-md transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span className="hidden sm:inline">Search (Cmd+K)</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50 backdrop-blur-sm px-4" onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
        }}>
          <div className="w-full max-w-xl bg-bg-app border border-border-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-border-subtle flex items-center">
              <svg className="text-text-secondary mr-3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                autoFocus
                className="flex-1 bg-transparent border-none outline-none text-text-primary placeholder-text-secondary text-[15px]"
                placeholder="Search Homeowners, Addresses, Phones..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button onClick={() => setOpen(false)} className="text-text-secondary text-xs uppercase tracking-wider font-semibold ml-2 hover:text-text-primary transition-colors">ESC</button>
            </div>
            
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {query.length < 2 ? (
                <p className="text-[12px] text-text-secondary text-center py-4">Start typing to search globally...</p>
              ) : loading ? (
                <p className="text-[12px] text-text-secondary text-center py-4">Searching...</p>
              ) : results.length === 0 ? (
                <p className="text-[12px] text-text-secondary text-center py-4">No results found for "{query}"</p>
              ) : (
                <div className="space-y-4">
                  {customers.length > 0 && (
                    <div>
                      <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2 px-1">Homeowners</h3>
                      <div className="space-y-1">
                        {customers.map(r => (
                          <button key={r.id} onClick={() => handleSelect(r)} className="w-full text-left bg-bg-elevated hover:bg-bg-card transition-colors py-2 px-3 rounded flex flex-col cursor-pointer border border-transparent hover:border-border-subtle">
                            <span className="text-[13px] text-text-primary font-medium">{r.title}</span>
                            <span className="text-[12px] text-text-secondary">{r.subtitle}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {properties.length > 0 && (
                    <div>
                      <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2 px-1">Addresses</h3>
                      <div className="space-y-1">
                        {properties.map(r => (
                          <button key={r.id} onClick={() => handleSelect(r)} className="w-full text-left bg-bg-elevated hover:bg-bg-card transition-colors py-2 px-3 rounded flex flex-col cursor-pointer border border-transparent hover:border-border-subtle">
                            <span className="text-[13px] text-text-primary font-medium">{r.title}</span>
                            <span className="text-[12px] text-text-secondary">{r.subtitle}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {leads.length > 0 && (
                    <div>
                      <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2 px-1">Leads</h3>
                      <div className="space-y-1">
                        {leads.map(r => (
                          <button key={r.id} onClick={() => handleSelect(r)} className="w-full text-left bg-bg-elevated hover:bg-bg-card transition-colors py-2 px-3 rounded flex flex-col cursor-pointer border border-transparent hover:border-border-subtle">
                            <span className="text-[13px] text-text-primary font-medium">{r.title}</span>
                            <span className="text-[12px] text-text-secondary">{r.subtitle}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
