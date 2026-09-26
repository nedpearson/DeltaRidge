import { useEffect, useState } from 'react'
import { Card, Button, TextInput } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export interface DocumentRow {
  id: string
  title: string
  category: string
  file_url: string
  file_type: string
  file_size_bytes: number | null
  created_at: string
}

const CATEGORIES = ['All', 'contract', 'proposal', 'estimate', 'eagleview', 'warranty', 'invoice', 'permit', 'other']

export default function DocumentCenter({ leadId, propertyId }: { leadId?: string; propertyId?: string }) {
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [filterCat, setFilterCat] = useState('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) return

      let query = supabase.from('documents').select('*').order('created_at', { ascending: false })
      
      if (leadId) query = query.eq('lead_id', leadId)
      if (propertyId) query = query.eq('property_id', propertyId)

      const { data } = await query
      if (data) setDocs(data as DocumentRow[])
      setLoading(false)
    }

    void load()
  }, [leadId, propertyId])

  const filtered = docs.filter(d => {
    if (filterCat !== 'All' && d.category !== filterCat) return false
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function formatBytes(bytes: number | null) {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDate(iso: string) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
  }

  return (
    <Card className="bg-bg-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-semibold text-text-primary text-[15px]">Document Center</h3>
        <Button variant="secondary" className="text-[12px] h-8">Upload Document</Button>
      </div>
      
      <div className="flex gap-2">
        <div className="flex-1">
          <TextInput 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Search documents..." 
            className="h-9 text-[13px]" 
          />
        </div>
        <select 
          className="h-9 rounded-md border border-border-subtle bg-bg-app px-2 text-[13px] text-text-primary outline-none focus:ring-2 focus:ring-brand-500"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All Categories' : c.toUpperCase()}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-8 text-center text-[13px] text-text-secondary">Loading documents...</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-text-secondary">No documents found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(doc => (
            <div key={doc.id} className="border border-border-subtle rounded-lg p-3 hover:bg-bg-app transition-colors flex flex-col gap-2 relative group cursor-pointer" onClick={() => window.open(doc.file_url, '_blank')}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-brand-500/10 text-brand-500 rounded text-[10px] font-bold uppercase">
                    {doc.file_type.split('/')[1] || 'FILE'}
                  </div>
                  <h4 className="font-semibold text-[13px] text-text-primary line-clamp-1" title={doc.title}>{doc.title}</h4>
                </div>
              </div>
              <div className="flex items-center justify-between mt-auto pt-2">
                <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{doc.category}</span>
                <div className="text-[11px] text-text-secondary flex gap-2">
                  <span>{formatBytes(doc.file_size_bytes)}</span>
                  <span>•</span>
                  <span>{formatDate(doc.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
