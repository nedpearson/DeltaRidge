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

interface SessionState {
  ready: boolean
  session: Session | null
  membership: Membership | null
  /** True when signed in but not yet a member of any organization. */
  awaitingAccess: boolean
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshMembership: () => Promise<void>
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

  const loadMembership = useCallback(
    async (s: Session | null) => {
      if (!supabase || !s) {
        setMembership(null)
        return
      }
      // RLS restricts this to the caller's own rows, so no user filter is
      // needed - and adding one would not make it safer.
      const { data, error } = await supabase
        .from('organization_members')
        .select('organization_id, role, organizations(name)')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (error || !data) {
        setMembership(null)
        return
      }
      const org = data.organizations as unknown as { name?: string } | null
      setMembership({
        organizationId: data.organization_id as string,
        organizationName: org?.name ?? 'Delta Ridge',
        role: data.role as Membership['role'],
      })
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
  }, [supabase])

  /**
   * Tells the outbox who is signed in, so every newly queued item is stamped
   * with its owner at capture time.
   *
   * A hook rather than a parameter on every save call: `queueSync` is called
   * from a dozen places — a knock, a note, a photo, a status change — and
   * threading the session through all of them means any future caller that
   * forgets it queues anonymous work that the next sign-in inherits.
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
      awaitingAccess: Boolean(session) && membership === null,
      signInWithEmail,
      signOut,
      refreshMembership: () => loadMembership(session),
    }),
    [ready, session, membership, signInWithEmail, signOut, loadMembership],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
