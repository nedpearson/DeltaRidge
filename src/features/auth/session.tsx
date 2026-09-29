import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { setOutboxOwnerSource } from '@/lib/db'
import { getSupabase } from '@/lib/supabase'

export interface Membership {
  organizationId: string
  organizationName: string
  role: 'admin' | 'manager' | 'salesperson' | 'office' | 'inspector'
}

export interface UserProfile {
  id: string
  fullName: string | null
  phone: string | null
  avatarUrl: string | null
}

interface SessionState {
  ready: boolean
  session: Session | null
  membership: Membership | null
  profile: UserProfile | null
  /** True when signed in but not yet a member of any organization. */
  awaitingAccess: boolean
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshMembership: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: string | null }>
}

const Ctx = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used inside <SessionProvider>')
  return v
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase()
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)

  const loadMembership = useCallback(
    async (s: Session | null) => {
      if (!supabase || !s) {
        setMembership(null)
        setProfile(null)
        return
      }
      
      // Load Membership
      const { data, error } = await supabase
        .from('organization_members')
        .select('organization_id, role, organizations(name)')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (error || !data) {
        setMembership(null)
      } else {
        const org = data.organizations as unknown as { name?: string } | null
        setMembership({
          organizationId: data.organization_id as string,
          organizationName: org?.name ?? 'Delta Ridge',
          role: data.role as Membership['role'],
        })
      }

      // Load Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name, phone, avatar_url')
        .eq('id', s.user.id)
        .limit(1)
        .maybeSingle()
        
      if (profileData) {
        setProfile({
          id: profileData.id,
          fullName: profileData.full_name,
          phone: profileData.phone,
          avatarUrl: profileData.avatar_url
        })
      } else {
        setProfile(null)
      }
    },
    [supabase],
  )

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    let cancelled = false

    void supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      await loadMembership(data.session)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      void loadMembership(s)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [supabase, loadMembership])

  const signInWithEmail = useCallback(
    async (email: string) => {
      if (!supabase) return { error: 'The server is not configured for this build.' }
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      return { error: error?.message ?? null }
    },
    [supabase],
  )

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
    setMembership(null)
    setProfile(null)
  }, [supabase])

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!supabase || !session) return { error: 'Not authenticated' }
    
    const dbPayload: any = {}
    if (updates.fullName !== undefined) dbPayload.full_name = updates.fullName
    if (updates.phone !== undefined) dbPayload.phone = updates.phone
    if (updates.avatarUrl !== undefined) dbPayload.avatar_url = updates.avatarUrl
    
    const { error } = await supabase
      .from('profiles')
      .update(dbPayload)
      .eq('id', session.user.id)
      
    if (error) return { error: error.message }
    
    setProfile(prev => prev ? { ...prev, ...updates } : null)
    return { error: null }
  }, [supabase, session])

  /**
   * Tells the outbox who is signed in, so every newly queued item is stamped
   * with its owner at capture time.
   */
  useEffect(() => {
    setOutboxOwnerSource(() => ({
      userId: session?.user.id ?? null,
      orgId: membership?.organizationId ?? null,
    }))
  }, [session, membership])

  const value = useMemo<SessionState>(
    () => ({
      ready,
      session,
      membership,
      profile,
      awaitingAccess: Boolean(session) && membership === null,
      signInWithEmail,
      signOut,
      refreshMembership: () => loadMembership(session),
      updateProfile,
    }),
    [ready, session, membership, profile, signInWithEmail, signOut, loadMembership, updateProfile],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
