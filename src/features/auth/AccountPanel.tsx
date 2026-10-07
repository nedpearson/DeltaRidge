import { useState } from 'react'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import { useSession } from './session'
import { supabaseConfigured } from '@/lib/supabase'

export default function AccountPanel() {
  const { session, membership, awaitingAccess, ready, signInWithPassword, signOut } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!supabaseConfigured()) return null
  if (!ready) return null

  async function signin() {
    setBusy(true)
    setError(null)
    const { error: e } = await signInWithPassword(email, password)
    setBusy(false)
    if (e) setError(e)
  }

  if (!session) {
    return (
      <div className="space-y-3 px-1 py-1">
        <Field label="Work email">
          <TextInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@delta-ridge.com"
            inputMode="email"
            autoComplete="email"
          />
        </Field>
        <Field label="Password">
          <TextInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.includes('@') && password) {
                void signin();
              }
            }}
          />
        </Field>
        {error && <p className="text-[12px] text-status-critical">{error}</p>}
        <Button full variant="primary" onClick={() => void signin()} disabled={busy || !email.includes('@') || !password}>
          {busy ? 'Signing In…' : 'Sign In'}
        </Button>
      </div>
    )
  }

  return (
    <>
      <SectionTitle>ACCOUNT</SectionTitle>
      <Card>
        <p className="text-[14px] font-semibold">{session.user.email}</p>
        {membership ? (
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {membership.organizationName} · {membership.role}
          </p>
        ) : awaitingAccess ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-status-warning/90">
            Signed in, but this account has not been added to Delta Ridge yet. Inspections stay safely on this
            device until it is — nothing is lost.
          </p>
        ) : null}
        <Button variant="ghost" className="mt-2 !px-0 text-[12px]" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </>
  )
}
