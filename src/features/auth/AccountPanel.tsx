import { useState } from 'react'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import { useSession } from './session'
import { supabaseConfigured } from '@/lib/supabase'

export default function AccountPanel() {
  const { session, membership, awaitingAccess, ready, signInWithEmail, signOut, resetPassword, savePassword, recoveringPassword } = useSession()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!supabaseConfigured()) return null
  if (!ready) return null

  async function submit(mode: 'login' | 'reset' | 'save') {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const result = mode === 'reset' ? await resetPassword(email) : mode === 'save' ? await savePassword(password) : await signInWithEmail(email, password)
      if (result.error) setError(mode === 'login' ? 'Unable to sign in. Check your email and password, then try again.' : result.error)
      else {
        setPassword('')
        setConfirm('')
        if (mode === 'reset') setNotice('If this account exists, check your email to set or reset your password.')
        if (mode === 'save') setNotice('Password saved.')
      }
    } catch {
      setError('Unable to reach the sign-in service. Please try again.')
    } finally { setBusy(false) }
  }

  if (!session || recoveringPassword) {
    return (
      <form className="space-y-3 px-1 py-1" onSubmit={(e) => { e.preventDefault(); void submit(recoveringPassword ? 'save' : 'login') }}>
        {!recoveringPassword && <Field label="Username (work email)">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@delta-ridge.com" autoComplete="username" required />
        </Field>}
        <Field label={recoveringPassword ? 'New password' : 'Password'}>
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={recoveringPassword ? 'new-password' : 'current-password'} required minLength={recoveringPassword ? 12 : undefined} />
        </Field>
        {recoveringPassword && <Field label="Confirm password"><TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></Field>}
        {error && <p role="alert" className="text-[12px] text-status-critical">{error}</p>}
        {notice && <p role="status" className="text-[12px] text-status-success">{notice}</p>}
        <Button type="submit" full variant="primary" disabled={busy || !password || (recoveringPassword ? password.length < 12 || password !== confirm : !email.includes('@'))}>
          {busy ? 'Please wait…' : recoveringPassword ? 'Save password' : 'Sign in'}
        </Button>
        {!recoveringPassword && <Button type="button" variant="ghost" full disabled={busy || !email.includes('@')} onClick={() => void submit('reset')}>Set or reset password</Button>}
        <p className="text-[11px] text-text-secondary">Use your own company account. Contact your administrator if you need access.</p>
      </form>
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

