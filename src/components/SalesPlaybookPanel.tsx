import { useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { BookOpen, Sparkles } from 'lucide-react'

export function SalesPlaybookPanel({}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="w-full mt-4 flex items-center justify-between p-3 bg-bg-app border border-border-subtle rounded-lg hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-brand-gold" />
          <span className="text-[12px] font-bold text-text-primary">Open Contextual Sales Playbook</span>
        </div>
        <Sparkles className="w-4 h-4 text-brand-gold/50" />
      </button>
    )
  }

  return (
    <Card className="mt-4 border-brand-gold/30 bg-brand-gold/5">
      <div className="flex justify-between items-center mb-3">
        <SectionTitle hint="Evidence-based talk tracks for this specific prospect profile.">
          SALES PLAYBOOK
        </SectionTitle>
        <button onClick={() => setIsOpen(false)} className="text-[10px] uppercase text-text-secondary hover:text-white">Close</button>
      </div>

      <div className="space-y-4">
        <div>
           <h4 className="text-[11px] font-bold text-brand-gold uppercase mb-1">Play: Aging Roof (15+ Years)</h4>
           <div className="bg-bg-app border border-brand-gold/20 p-3 rounded text-[12px] text-text-primary">
             <p className="font-semibold mb-2">Factual Data:</p>
             <ul className="list-disc pl-4 text-text-secondary mb-3 space-y-1">
               <li>Zillow records show home built in 2008.</li>
               <li>No permits pulled for re-roof since construction.</li>
               <li>Recent 1.5" hail storm in sector.</li>
             </ul>
             <p className="font-semibold mb-2">Suggested Talk Track:</p>
             <p className="italic text-text-secondary bg-white/5 p-2 rounded border-l-2 border-brand-gold">
               "Hi, we're doing some work in the neighborhood. I noticed your roof is approaching the 15-year mark based on city records. Given the recent hail cell that came through, many of your neighbors are getting fully approved by insurance before the winter season hits. Would you like a free photo report of your roof's condition?"
             </p>
           </div>
        </div>
      </div>
    </Card>
  )
}
