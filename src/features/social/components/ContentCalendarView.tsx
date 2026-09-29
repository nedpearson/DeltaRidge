import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'
import { Calendar as CalendarIcon, CheckCircle, Clock, BarChart2, AlertTriangle } from 'lucide-react'

type Filter = 'all' | 'draft' | 'awaiting_approval' | 'scheduled' | 'published' | 'failed'

function localDateTimeValue(iso?: string | null) {
  const date = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000)
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export default function ContentCalendarView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { membership } = useSession()
  const orgId = membership?.organizationId ?? null
  const canApprove = membership?.role === 'admin' || membership?.role === 'manager'
  const [filter, setFilter] = useState<Filter>('all')
  const [actionError, setActionError] = useState<string | null>(null)
  const [accountByPost, setAccountByPost] = useState<Record<string, string>>({})
  const [timeByPost, setTimeByPost] = useState<Record<string, string>>({})

  const { data: posts = [], isLoading, error } = useQuery({
    queryKey: ['content_calendar', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const supabase = getSupabase()
      if (!supabase || !orgId) return []
      const result = await supabase
        .from('content_calendar')
        .select(`
          *,
          account:social_accounts(id, platform, account_name, is_active),
          asset:creative_assets(url, asset_type, content)
        `)
        .eq('organization_id', orgId)
        .order('scheduled_for', { ascending: true, nullsFirst: false })
      if (result.error) throw result.error
      return result.data ?? []
    },
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['content_calendar_accounts', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const supabase = getSupabase()
      if (!supabase || !orgId) return []
      const result = await supabase
        .from('social_accounts')
        .select('id, platform, account_name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('account_name')
      if (result.error) throw result.error
      return result.data ?? []
    },
  })

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabase()
      if (!supabase || !orgId) throw new Error('Organization access is required.')
      const result = await supabase
        .from('content_calendar')
        .update({ status: 'awaiting_approval' })
        .eq('organization_id', orgId)
        .eq('id', id)
        .eq('status', 'draft')
      if (result.error) throw result.error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content_calendar', orgId] }),
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Could not submit post.'),
  })

  const approveMutation = useMutation({
    mutationFn: async ({ id, accountId, localTime }: { id: string; accountId: string; localTime: string }) => {
      const supabase = getSupabase()
      if (!supabase) throw new Error('Server is not configured.')
      if (!accountId) throw new Error('Select a connected social account.')
      const parsed = new Date(localTime)
      if (!localTime || !Number.isFinite(parsed.getTime())) throw new Error('Choose a valid scheduled time.')
      const result = await supabase.rpc('approve_content_calendar_post', {
        p_post: id,
        p_account: accountId,
        p_scheduled_for: parsed.toISOString(),
      })
      if (result.error) throw result.error
    },
    onSuccess: () => {
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['content_calendar', orgId] })
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Could not approve post.'),
  })

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabase()
      if (!supabase) throw new Error('Server is not configured.')
      const result = await supabase.rpc('retry_content_calendar_post', { p_post: id })
      if (result.error) throw result.error
    },
    onSuccess: () => {
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['content_calendar', orgId] })
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Could not retry post.'),
  })

  const filteredPosts = useMemo(
    () => posts.filter((post) => filter === 'all' || post.status === filter),
    [posts, filter],
  )

  if (!orgId) return <div className="p-8 text-center text-text-secondary">Organization access is required.</div>

  return (
    <div className="flex-1 bg-bg-app p-6 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Content Calendar</h1>
          <p className="text-text-secondary mt-1">Approve, schedule and verify provider-confirmed publishing.</p>
        </div>
        <button onClick={() => navigate('/studio')} className="px-4 py-2 bg-brand-primary text-white rounded font-medium hover:bg-brand-primary/90">
          Create Post
        </button>
      </div>

      {actionError && <div className="mb-4 rounded border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{actionError}</div>}
      {error && <div className="mb-4 rounded border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">Calendar could not be loaded: {error instanceof Error ? error.message : 'Unknown error'}</div>}

      <div className="flex gap-2 mb-6 overflow-x-auto">
        {[
          ['all', 'All'],
          ['draft', 'Draft'],
          ['awaiting_approval', 'Awaiting Approval'],
          ['scheduled', 'Scheduled'],
          ['published', 'Published'],
          ['failed', 'Failed'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id as Filter)} className={'px-4 py-2 rounded-full text-sm font-medium shrink-0 ' + (filter === id ? 'bg-brand-primary text-white' : 'bg-bg-elevated text-text-secondary hover:bg-bg-card')}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-secondary">Loading calendar…</div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-12 bg-bg-card rounded-xl border border-border-subtle">
          <CalendarIcon className="w-12 h-12 mx-auto text-text-secondary opacity-20 mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No posts found</h3>
          <p className="text-text-secondary">There are no records in this state.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredPosts.map((post) => {
            const accountId = accountByPost[post.id] ?? post.social_account_id ?? ''
            const localTime = timeByPost[post.id] ?? localDateTimeValue(post.scheduled_for)
            const copy = post.asset?.content ?? ''
            const busy = submitMutation.isPending || approveMutation.isPending || retryMutation.isPending
            return (
              <div key={post.id} className="bg-bg-card p-5 rounded-xl border border-border-subtle flex items-start gap-4">
                <div className="w-24 h-24 bg-bg-elevated rounded flex-shrink-0 border border-border-subtle overflow-hidden">
                  {post.asset?.url ? <img src={post.asset.url} alt="Creative" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">No Media</div>}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary text-xs rounded font-medium capitalize">{post.account?.platform || 'No account'}</span>
                      <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary text-xs rounded font-medium capitalize">{post.content_pillar || 'Uncategorized'}</span>
                      <span className="text-xs font-medium capitalize">{String(post.status).replaceAll('_', ' ')}</span>
                    </div>
                    <div className="text-sm text-text-secondary">{post.scheduled_for ? new Date(post.scheduled_for).toLocaleString() : 'Not scheduled'}</div>
                  </div>

                  <p className="text-sm text-text-primary whitespace-pre-wrap line-clamp-3 mb-4">{copy || 'No text copy attached.'}</p>

                  {post.status === 'draft' && (
                    <button onClick={() => submitMutation.mutate(post.id)} className="px-3 py-1.5 bg-brand-primary text-white text-xs rounded font-medium" disabled={busy}>
                      Submit for Approval
                    </button>
                  )}

                  {post.status === 'awaiting_approval' && (
                    <div className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                      <label className="text-xs text-text-secondary">
                        Connected account
                        <select
                          value={accountId}
                          onChange={(event) => setAccountByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                          className="mt-1 w-full rounded border border-border-subtle bg-bg-app px-2 py-2 text-text-primary"
                        >
                          <option value="">Select account</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name} · {account.platform}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-text-secondary">
                        Publish time
                        <input
                          type="datetime-local"
                          value={localTime}
                          onChange={(event) => setTimeByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                          className="mt-1 w-full rounded border border-border-subtle bg-bg-app px-2 py-2 text-text-primary"
                        />
                      </label>
                      <button
                        disabled={!canApprove || busy}
                        onClick={() => approveMutation.mutate({ id: post.id, accountId, localTime })}
                        className="px-3 py-2 bg-status-success text-white text-xs rounded font-medium disabled:opacity-50"
                      >
                        Approve & Schedule
                      </button>
                    </div>
                  )}

                  {post.status === 'failed' && (
                    <div>
                      <div className="flex items-start gap-2 rounded border border-status-error/30 bg-status-error/10 p-2 text-xs text-status-error mb-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{post.failure_reason || 'Publishing failed without a recorded reason.'}</span>
                      </div>
                      {canApprove && (
                        <button onClick={() => retryMutation.mutate(post.id)} className="px-3 py-1.5 bg-status-error text-white text-xs rounded font-medium" disabled={busy}>
                          Retry Now
                        </button>
                      )}
                    </div>
                  )}

                  {post.status === 'published' && (
                    <div className="flex flex-wrap gap-4 p-3 bg-bg-app rounded border border-border-subtle">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-status-success" />
                        <span className="font-medium">Provider ID: {post.platform_post_id || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <BarChart2 className="w-4 h-4 text-text-secondary" />
                        <span className="font-medium">{typeof post.performance_metrics?.impressions === 'number' ? post.performance_metrics.impressions : 'N/A'}</span>
                        <span className="text-text-secondary text-xs">Impressions</span>
                      </div>
                    </div>
                  )}

                  {(post.status === 'scheduled' || post.status === 'attempting') && (
                    <div className="flex items-center gap-1 text-brand-400 text-xs font-medium mt-2">
                      <Clock className="w-3 h-3" /> {post.status === 'attempting' ? 'Publishing attempt in progress' : 'Waiting for scheduled worker'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
