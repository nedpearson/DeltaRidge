import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Empty, PageHeader } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export default function LeadsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('property_opportunity_scores')
        .select('*')
        .order('opportunity_score', { ascending: false })
        .limit(50)
      
      if (!error && data) {
        setProperties(data)
      }
      setLoading(false)
    }
    void load()
  }, [])

  return (
    <div className="mx-auto max-w-screen-sm pb-24 pt-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader 
          title="Storm Opportunities" 
          description="Top ranked properties affected by recent storm events." 
        />
        
        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-sm text-text-secondary">Loading opportunities...</p>
          ) : properties.length === 0 ? (
            <Empty title="No opportunities found" body="No properties have been scored by the storm engine yet." />
          ) : (
            properties.map(p => (
              <div key={p.property_id} onClick={() => navigate('/property/' + p.property_id)} className="cursor-pointer group">
                <Card className="group-hover:bg-bg-elevated transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-text-primary">Property ID: {p.property_id.substring(0, 8)}</h3>
                      <p className="text-sm text-text-secondary mt-1">
                        {p.max_wind ? 'Wind: ' + p.max_wind + ' MPH' : ''} 
                        {p.max_hail ? ' | Hail: ' + p.max_hail + ' inches' : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-display font-bold text-brand-primary">{p.opportunity_score}</span>
                      <p className="text-[10px] uppercase text-text-muted mt-0.5 tracking-wider">Score</p>
                    </div>
                  </div>
                </Card>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
