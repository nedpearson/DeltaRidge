import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'

interface FeatureFlag {
  id: string
  enabled_for_all: boolean
  enabled_for_roles: string[]
  enabled_for_users: string[]
}

const CACHE = new Map<string, FeatureFlag>()

export function useFeatureFlag(flagId: string): boolean {
  const { session, membership } = useSession()
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    async function checkFlag() {
      const supabase = getSupabase()
      if (!supabase || !session) return

      let flag = CACHE.get(flagId)
      
      if (!flag) {
        const { data } = await supabase
          .from('feature_flags')
          .select('*')
          .eq('id', flagId)
          .single()

        if (data) {
          flag = data as FeatureFlag
          CACHE.set(flagId, flag)
        }
      }

      if (!flag) {
        setEnabled(false)
        return
      }

      if (flag.enabled_for_all) {
        setEnabled(true)
        return
      }

      if (membership?.role && flag.enabled_for_roles.includes(membership.role)) {
        setEnabled(true)
        return
      }

      if (flag.enabled_for_users.includes(session.user.id)) {
        setEnabled(true)
        return
      }

      setEnabled(false)
    }

    void checkFlag()
  }, [flagId, session, membership])

  return enabled
}
