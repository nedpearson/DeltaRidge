import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { BookOpen, Plus, Shield, CheckCircle, Clock, Edit2, Trash2, X } from 'lucide-react';
import { useSession } from '@/features/auth/session';

export default function BrandBrainView() {
  const session = useSession();
  const orgId = session?.membership?.organizationId || '00000000-0000-0000-0000-000000000000';
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'faq' | 'founder_story' | 'policy' | 'tone'>('faq');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [topic, setTopic] = useState('');
  const [entryContent, setEntryContent] = useState('');

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      
      if (editingId) {
        const { error } = await supabase
          .from('brand_knowledge')
          .update({ topic, content: entryContent, category: activeTab })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('brand_knowledge')
          .insert({
            organization_id: orgId,
            category: activeTab,
            topic,
            content: entryContent,
            is_approved: true
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand_knowledge'] });
      closeForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      const { error } = await supabase.from('brand_knowledge').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand_knowledge'] });
    }
  });

  const openForm = (item?: any) => {
    if (item) {
      setEditingId(item.id);
      setTopic(item.topic);
      setEntryContent(item.content);
      setActiveTab(item.category as any);
    } else {
      setEditingId(null);
      setTopic('');
      setEntryContent('');
    }
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTopic('');
    setEntryContent('');
  };

  const filteredKnowledge = knowledge.filter((k: any) => k.category === activeTab);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-app p-6 relative">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-brand-600" />
            Brand Brain
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Curate the knowledge base used by the AI Concierge to respond to homeowners.
          </p>
        </div>
        <button 
          onClick={() => openForm()}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      <div className="flex gap-4 mb-6 border-b border-border-subtle">
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

      <div className="bg-bg-card rounded-lg border border-border-subtle shadow-sm flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-text-secondary">Loading knowledge base...</div>
        ) : filteredKnowledge.length === 0 ? (
          <div className="p-12 text-center text-text-secondary">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-base font-medium text-text-primary mb-1">No {activeTab.replace('_', ' ')} entries yet</p>
            <p className="text-sm mb-4">Add your first entry to train the AI on how Delta Ridge handles this.</p>
            <button onClick={() => openForm()} className="px-4 py-2 bg-bg-card border border-border-subtle rounded font-medium text-sm hover:bg-bg-app shadow-sm text-text-primary">
              Create Entry
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredKnowledge.map((item: any) => (
              <div key={item.id} className="p-5 hover:bg-bg-app transition-colors group">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-text-primary text-base">{item.topic}</h3>
                  <div className="flex items-center gap-3">
                    {item.is_approved ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-status-success bg-status-success/10 px-2 py-1 rounded-full">
                        <CheckCircle className="w-3 h-3" /> Approved
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-warning-highlight bg-warning-surface/20 px-2 py-1 rounded-full border border-warning-border">
                        <Clock className="w-3 h-3" /> Pending Review
                      </span>
                    )}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openForm(item)} className="p-1 text-text-secondary hover:text-text-primary rounded hover:bg-bg-elevated">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteMutation.mutate(item.id)} className="p-1 text-text-secondary hover:text-status-critical rounded hover:bg-bg-elevated">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{item.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {showForm && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center p-6 z-50">
          <div className="bg-bg-card p-6 rounded-lg w-full max-w-lg shadow-xl border border-border-subtle">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-text-primary">{editingId ? 'Edit Entry' : 'Add Entry'}</h3>
              <button onClick={closeForm} className="text-text-secondary hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Topic / Question</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-sm focus:outline-none focus:border-brand-500"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g. Do we waive deductibles?"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">Answer / Content</label>
                <textarea 
                  className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-sm h-32 focus:outline-none focus:border-brand-500"
                  value={entryContent}
                  onChange={e => setEntryContent(e.target.value)}
                  placeholder="Type the exact knowledge the AI should use..."
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={closeForm} className="px-4 py-2 bg-bg-app text-text-primary border border-border-subtle rounded text-sm font-medium hover:bg-bg-elevated">
                  Cancel
                </button>
                <button 
                  onClick={() => saveMutation.mutate()} 
                  disabled={saveMutation.isPending || !topic || !entryContent}
                  className="px-4 py-2 bg-brand-600 text-white rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
