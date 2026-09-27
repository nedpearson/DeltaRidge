import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { BookOpen, Plus, Shield, CheckCircle, Clock } from 'lucide-react';

export default function BrandBrainView() {
  const [activeTab, setActiveTab] = useState<'faq' | 'founder_story' | 'policy' | 'tone'>('faq');

  const { data: knowledge = [], isLoading } = useQuery({
    queryKey: ['brand_knowledge'],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('brand_knowledge')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const filteredKnowledge = knowledge.filter(k => k.category === activeTab);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-50 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-brand-600" />
            Brand Brain
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Curate the knowledge base used by the AI Concierge to respond to homeowners.
          </p>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 shadow-sm">
          <Plus className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      <div className="flex gap-4 mb-6 border-b border-border">
        {(['faq', 'founder_story', 'policy', 'tone'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-brand-500 text-brand-600' 
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border shadow-sm flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-text-secondary">Loading knowledge base...</div>
        ) : filteredKnowledge.length === 0 ? (
          <div className="p-12 text-center text-text-secondary">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-base font-medium text-text mb-1">No {activeTab.replace('_', ' ')} entries yet</p>
            <p className="text-sm mb-4">Add your first entry to train the AI on how Delta Ridge handles this.</p>
            <button className="px-4 py-2 bg-white border border-border rounded font-medium text-sm hover:bg-surface-50 shadow-sm text-text">
              Create Entry
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredKnowledge.map((item) => (
              <div key={item.id} className="p-5 hover:bg-surface-50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-text text-base">{item.topic}</h3>
                  {item.is_approved ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-status-success bg-status-success/10 px-2 py-1 rounded-full">
                      <CheckCircle className="w-3 h-3" /> Approved
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-warning-highlight bg-warning-surface/20 px-2 py-1 rounded-full border border-warning-border">
                      <Clock className="w-3 h-3" /> Pending Review
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{item.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
