import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { Calendar as CalendarIcon, CheckCircle, Clock, XCircle, BarChart2 } from 'lucide-react';
import type { ContentCalendar } from '../types';

export default function ContentCalendarView() {
  const [filter, setFilter] = useState<'all' | 'draft' | 'scheduled' | 'published'>('all');

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

  const filteredPosts = posts.filter(p => filter === 'all' || p.status === filter);

  return (
    <div className="flex-1 bg-surface-50 p-6 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text">Content Calendar</h1>
          <p className="text-text-secondary mt-1">Schedule, approve, and track ROI on your creative assets.</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded font-medium hover:bg-brand-700">
          Create Post
        </button>
      </div>

      <div className="flex gap-4 mb-6">
        {['all', 'draft', 'scheduled', 'published'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize ${
              filter === f 
                ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-500' 
                : 'bg-white text-text-secondary hover:bg-surface-100'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-secondary">Loading calendar...</div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-border">
          <CalendarIcon className="w-12 h-12 mx-auto text-text-secondary opacity-20 mb-4" />
          <h3 className="text-lg font-medium text-text mb-2">No posts found</h3>
          <p className="text-text-secondary">Your content calendar is currently empty.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredPosts.map(post => (
            <div key={post.id} className="bg-white p-5 rounded-xl border border-border shadow-sm flex items-start gap-4">
              <div className="w-24 h-24 bg-surface-100 rounded flex-shrink-0 border border-border overflow-hidden">
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
                    <span className="px-2 py-0.5 bg-surface-100 text-text-secondary text-xs rounded font-medium capitalize">
                      {post.account?.platform || 'Multi-platform'}
                    </span>
                    <span className="px-2 py-0.5 bg-surface-100 text-text-secondary text-xs rounded font-medium capitalize">
                      {post.content_pillar}
                    </span>
                    {post.status === 'published' && <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" /> Published</span>}
                    {post.status === 'scheduled' && <span className="flex items-center gap-1 text-blue-600 text-xs font-medium"><Clock className="w-3 h-3" /> Scheduled</span>}
                    {post.status === 'draft' && <span className="flex items-center gap-1 text-orange-600 text-xs font-medium"><Clock className="w-3 h-3" /> Draft</span>}
                  </div>
                  <div className="text-sm font-medium text-text-secondary">
                    {new Date(post.scheduled_for || post.created_at).toLocaleDateString()}
                  </div>
                </div>
                <p className="text-sm text-text line-clamp-2 mb-4">{post.content}</p>
                
                {post.status === 'published' && (
                  <div className="flex gap-4 p-3 bg-surface-50 rounded border border-border">
                    <div className="flex items-center gap-2 text-sm">
                      <BarChart2 className="w-4 h-4 text-text-secondary" />
                      <span className="font-medium">{post.performance_metrics?.impressions || 0}</span>
                      <span className="text-text-secondary text-xs">Impressions</span>
                    </div>
                    <div className="w-px bg-border"></div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-brand-600">${post.performance_metrics?.attributed_revenue || 0}</span>
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
