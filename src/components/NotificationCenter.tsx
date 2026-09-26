import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSupabase } from '@/lib/supabase'

export interface AppNotification {
  id: string
  title: string
  body: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  link_url?: string | null
  read_at?: string | null
  created_at: string
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    async function fetchNotifications() {
      const { data } = await getSupabase()!
        .from('notifications')
        .select('*')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10)

      if (data) setNotifications(data as AppNotification[])
    }

    void fetchNotifications()

    // Realtime subscription
    const sub = getSupabase()!
      .channel('public:notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        setNotifications(prev => [payload.new as AppNotification, ...prev])
      })
      .subscribe()

    return () => {
      void getSupabase()!.removeChannel(sub)
    }
  }, [])

  async function markRead(id: string) {
    const supabase = getSupabase()
    if (!supabase) return
    setNotifications(prev => prev.filter(n => n.id !== id))
    await getSupabase()!.rpc('mark_notification_read', { notification_id: id })
  }

  return (
    <div className="relative">
      <button 
        onClick={() => setOpen(!open)}
        className="relative p-2 text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 flex h-3 w-3 items-center justify-center rounded-full bg-status-error text-[8px] font-bold text-white">
            {notifications.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 z-50 rounded-lg border border-border-subtle bg-bg-card shadow-lg ring-1 ring-black ring-opacity-5">
            <div className="border-b border-border-subtle px-4 py-3 flex justify-between items-center bg-bg-elevated rounded-t-lg">
              <h3 className="text-[13px] font-semibold text-text-primary">Notifications</h3>
              <span className="text-[11px] text-brand-500 font-medium cursor-pointer">Mark all read</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-text-secondary">
                  No new notifications.
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-bg-app transition-colors relative group">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 pr-4">
                        <p className={`text-[13px] font-semibold ${n.priority === 'critical' ? 'text-status-error' : n.priority === 'high' ? 'text-status-warning' : 'text-text-primary'}`}>
                          {n.title}
                        </p>
                        <p className="text-[12px] text-text-secondary mt-0.5 leading-relaxed">{n.body}</p>
                        {n.link_url && (
                          <Link to={n.link_url} className="text-[11px] font-semibold text-brand-400 mt-2 inline-block" onClick={() => setOpen(false)}>
                            View Details →
                          </Link>
                        )}
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                        className="text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        title="Mark as read"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
