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

      // ---------------------------------------------------------------
      // 1. Build team status from actual data — no invented states.
      // ---------------------------------------------------------------
      const { data: recentActivities } = await supabase
        .from('activities')
        .select('user_id, occurred_at, activity_type, leads(address)')
        .order('occurred_at', { ascending: false })
        .limit(200)

      const repMap = new Map<string, { lastActivity: string; doors: number; appts: number; name: string }>()

      if (recentActivities) {
        for (const act of recentActivities) {
          if (!act.user_id) continue
          const existing = repMap.get(act.user_id) || {
            lastActivity: act.occurred_at,
            doors: 0,
            appts: 0,
            name: 'Rep ' + act.user_id.substring(0, 4)
          }

          if (new Date(act.occurred_at) > new Date(existing.lastActivity)) {
            existing.lastActivity = act.occurred_at
          }
          if (act.activity_type === 'knock') existing.doors++
          if (act.activity_type === 'appointment') existing.appts++
          repMap.set(act.user_id, existing)
        }
      }

      // ---------------------------------------------------------------
      // Check for actual active routes from the route_sessions table.
      // A rep is only "on route" if they have an open route_session.
      // ---------------------------------------------------------------
      const repIds = Array.from(repMap.keys())
      const activeRouteMap = new Map<string, string>()

      if (repIds.length > 0) {
        const { data: activeRoutes } = await supabase
          .from('route_sessions')
          .select('user_id, started_at')
          .in('user_id', repIds)
          .is('ended_at', null)

        if (activeRoutes) {
          for (const route of activeRoutes) {
            const startedAt = new Date(route.started_at)
            activeRouteMap.set(
              route.user_id,
              'Route since ' + startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            )
          }
        }
      }

      const teamNow = Array.from(repMap.entries()).map(([id, info]) => {
        const minsAgo = Math.floor((Date.now() - new Date(info.lastActivity).getTime()) / 60000)
        const hasActiveRoute = activeRouteMap.has(id)

        // Status is derived from actual route session, not from recent activity alone.
        let status: string
        if (hasActiveRoute) {
          status = activeRouteMap.get(id)!
        } else if (minsAgo < 60) {
          status = 'Last activity ' + minsAgo + 'm ago'
        } else {
          status = 'No recent activity'
        }

        return {
          repId: id,
          repName: info.name,
          status,
          lastActivityAgo: minsAgo < 60 ? minsAgo + 'm ago' : Math.floor(minsAgo / 60) + 'h ago',
          route: hasActiveRoute ? activeRouteMap.get(id)! : null,
          doors: info.doors,
          appts: info.appts,
          // Sync status: show actual sync state, not a hardcoded "Synced".
          // Until we have real sync acknowledgment tracking, be honest.
          syncStatus: 'Unknown'
        }
      })

      // ---------------------------------------------------------------
      // 2. Fetch exception/attention items from notifications
      // ---------------------------------------------------------------
      const { data: exceptions } = await supabase
        .from('notifications')
        .select('*')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10)

      const attentionNeeded = (exceptions || []).map(ex => ({
        id: ex.id as string,
        type: (ex.priority === 'critical' ? 'critical' : ex.priority === 'high' ? 'exception' : 'opportunity') as 'critical' | 'exception' | 'opportunity',
        title: ex.title as string,
        body: ex.body as string,
        actionLabel: ex.link_url ? 'Fix Now' : 'Dismiss',
        actionUrl: ex.link_url || ''
      }))

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
