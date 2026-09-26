import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface ManagerCommandCenterData {
  teamNow: {
    repId: string
    repName: string
    status: string
    lastActivityAgo: string
    route: string | null
    doors: number
    appts: number
    syncStatus: string
  }[]
  attentionNeeded: {
    id: string
    type: 'exception' | 'critical' | 'opportunity'
    title: string
    body: string
    actionLabel: string
    actionUrl: string
  }[]
  lastUpdated: string
}

export function useManagerCommandCenter() {
  const [data, setData] = useState<ManagerCommandCenterData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      // 1. Fetch team members (users)
       // Just getting org
      // For now, let's just use activities to infer the active team
      const { data: recentActivities } = await supabase
        .from('activities')
        .select('user_id, created_at, type, leads(address)')
        .order('created_at', { ascending: false })
        .limit(100)

      const repMap = new Map<string, { lastActivity: string, doors: number, appts: number, name: string }>()
      
      if (recentActivities) {
        recentActivities.forEach(act => {
          if (!act.user_id) return
          const existing = repMap.get(act.user_id) || { lastActivity: act.created_at, doors: 0, appts: 0, name: 'Rep ' + act.user_id.substring(0, 4) }
          
          if (new Date(act.created_at) > new Date(existing.lastActivity)) {
            existing.lastActivity = act.created_at
          }
          if (act.type === 'knock') existing.doors++
          if (act.type === 'appointment') existing.appts++
          repMap.set(act.user_id, existing)
        })
      }

      const teamNow = Array.from(repMap.entries()).map(([id, info]) => {
        const minsAgo = Math.floor((new Date().getTime() - new Date(info.lastActivity).getTime()) / 60000)
        return {
          repId: id,
          repName: info.name,
          status: minsAgo < 60 ? 'ACTIVE ROUTE' : 'INACTIVE',
          lastActivityAgo: minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`,
          route: 'Active Area',
          doors: info.doors,
          appts: info.appts,
          syncStatus: 'Synced'
        }
      })

      // 2. Fetch Notifications/Exceptions
      const { data: exceptions } = await supabase
        .from('notifications')
        .select('*')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(5)

      const attentionNeeded = (exceptions || []).map(ex => ({
        id: ex.id,
        type: ex.priority === 'critical' ? 'critical' : ex.priority === 'high' ? 'exception' : 'opportunity',
        title: ex.title,
        body: ex.body,
        actionLabel: ex.link_url ? 'Fix Now' : 'Dismiss',
        actionUrl: ex.link_url || '#'
      })) as ManagerCommandCenterData['attentionNeeded']

      setData({
        teamNow,
        attentionNeeded,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}
