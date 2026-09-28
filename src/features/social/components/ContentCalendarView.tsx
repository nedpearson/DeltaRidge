/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { Calendar as CalendarIcon, CheckCircle, Clock, BarChart2 } from 'lucide-react';

export default function ContentCalendarView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'draft' | 'awaiting_approval' | 'scheduled' | 'published' | 'failed'>('all');

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['content_calendar'],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) return [];
      
      const { data, error } = await supabase
        .from('content_calendar')
        .select(`
          *,
          account:social_accounts(platform, account_name),
          asset:creative_assets(url, asset_type)
        `)
        .order('scheduled_for', { ascending: true });
        
      if (error) throw error;
      
      return data as any[];
    }
  });

  
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('No Supabase client');
      const { error } = await supabase
        .from('content_calendar')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content_calendar'] });
    }
  });

  const filteredPosts = posts.filter((p: any) => filter === 'all' || p.status === filter);

  return (
    <div className="flex-1 bg-bg-app p-6 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Content Calendar</h1>
          <p className="text-text-secondary mt-1">Schedule, approve, and track ROI on your creative assets.</p>
        </div>
        <button onClick={() => navigate('/studio')} className="px-4 py-2 bg-brand-primary text-white rounded font-medium hover:bg-brand-primary">
          Create Post
        </button>
      </div>

            <div className="flex gap-4 mb-6">
        {[
          { id: 'all', label: 'All' },
          { id: 'draft', label: 'Draft' },
          { id: 'awaiting_approval', label: 'Awaiting Approval' },
          { id: 'scheduled', label: 'Scheduled' },
          { id: 'published', label: 'Published' },
          { id: 'failed', label: 'Failed' }
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as any)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${filter === f.id ? "bg-brand-primary text-brand-950" : "bg-bg-elevated text-text-secondary hover:bg-bg-card"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-secondary">Loading calendar...</div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-12 bg-bg-card rounded-xl border border-border-subtle">
          <CalendarIcon className="w-12 h-12 mx-auto text-text-secondary opacity-20 mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No posts found</h3>
          <p className="text-text-secondary">Your content calendar is currently empty.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredPosts.map(post => (
            <div key={post.id} className="bg-bg-card p-5 rounded-xl border border-border-subtle shadow-sm flex items-start gap-4">
              <div className="w-24 h-24 bg-bg-elevated rounded flex-shrink-0 border border-border-subtle overflow-hidden">
                {post.asset?.url ? (
                  <img src={post.asset.url} alt="Creative" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">
                    No Media
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary text-xs rounded font-medium capitalize">
                      {post.account?.platform || 'Multi-platform'}
                    </span>
                    <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary text-xs rounded font-medium capitalize">
                      {post.content_pillar}
                    </span>
                                        {post.status === 'published' && <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" /> Published</span>}
                    {post.status === 'scheduled' && <span className="flex items-center gap-1 text-brand-primary text-xs font-medium"><Clock className="w-3 h-3" /> Scheduled</span>}
                    {post.status === 'draft' && <span className="flex items-center gap-1 text-status-warning text-xs font-medium"><Clock className="w-3 h-3" /> Draft</span>}
                    {post.status === 'awaiting_approval' && <span className="flex items-center gap-1 text-status-warning text-xs font-medium"><Clock className="w-3 h-3" /> Awaiting Approval</span>}
                    {post.status === 'failed' && <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><CheckCircle className="w-3 h-3" /> Failed</span>}
                  </div>
                  <div className="text-sm font-medium text-text-secondary">
                    {new Date(post.scheduled_for || post.created_at).toLocaleDateString()}
                  </div>
                </div>
                <p className="text-sm text-text-primary line-clamp-2 mb-4">{post.content}</p>
                <div className="flex gap-2 mb-4">
                  {post.status === 'draft' && (
                    <button 
                      onClick={() => updateStatusMutation.mutate({ id: post.id, status: 'awaiting_approval' })}
                      className="px-3 py-1 bg-brand-primary text-white text-xs rounded font-medium hover:bg-brand-primary/90"
                      disabled={updateStatusMutation.isPending}
                    >
                      Submit for Approval
                    </button>
                  )}
                  {post.status === 'awaiting_approval' && (
                    <button 
                      onClick={() => updateStatusMutation.mutate({ id: post.id, status: 'scheduled' })}
                      className="px-3 py-1 bg-green-600 text-white text-xs rounded font-medium hover:bg-green-700"
                      disabled={updateStatusMutation.isPending}
                    >
                      Approve & Schedule
                    </button>
                  )}
                  {post.status === 'failed' && (
                    <button 
                      onClick={() => updateStatusMutation.mutate({ id: post.id, status: 'scheduled' })}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded font-medium hover:bg-red-700"
                      disabled={updateStatusMutation.isPending}
                    >
                      Retry Publish
                    </button>
                  )}
                </div>
                
                {post.status === 'published' && (
                  <div className="flex gap-4 p-3 bg-bg-app rounded border border-border-subtle">
                    <div className="flex items-center gap-2 text-sm">
                      <BarChart2 className="w-4 h-4 text-text-secondary" />
                      <span className="font-medium">{post.performance_metrics?.impressions || 0}</span>
                      <span className="text-text-secondary text-xs">Impressions</span>
                    </div>
                    <div className="w-px bg-border"></div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-brand-primary">${post.performance_metrics?.attributed_revenue || 0}</span>
                      <span className="text-text-secondary text-xs">Attributed Pipeline</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}







