import { useEffect, useState } from 'react'
import { Button } from './ui'

export function UniversalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

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

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="flex items-center gap-2 py-1 px-2 text-xs text-text-secondary bg-bg-elevated hover:bg-bg-card/20">
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
              <button onClick={() => setOpen(false)} className="text-text-secondary text-xs uppercase tracking-wider font-semibold ml-2 hover:text-text-primary">ESC</button>
            </div>
            
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {query.length === 0 ? (
                <p className="text-[12px] text-text-secondary text-center py-4">Start typing to search globally...</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Homeowners</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching homeowners</p>
                  </div>
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Addresses</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching addresses</p>
                  </div>
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Phones</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching phone records</p>
                  </div>
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Leads</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching leads</p>
                  </div>
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Appointments</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching appointments</p>
                  </div>
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Roofr Jobs</h3>
                    <p className="text-[13px] text-text-secondary bg-bg-elevated py-2 px-3 rounded">No matching jobs</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
