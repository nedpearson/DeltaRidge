import { useState } from 'react'
import { Button, Card, Field, SectionTitle, TextInput } from '@/components/ui'
import { useSession } from './session'
import { supabaseConfigured } from '@/lib/supabase'

/**
 * Sign-in and account state.
 *
 * Magic link rather than a password: there is no password for the app to
 * store, nothing for a rep to forget on a roof, and one less credential to
 * handle anywhere in this system.
 */
export default function AccountPanel() {
  const { session, membership, awaitingAccess, ready, signInWithEmail, signOut } = useSession()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!supabaseConfigured()) return null
  if (!ready) return null

  async function send() {
    setBusy(true)
    setError(null)
    const { error: e } = await signInWithEmail(email)
    setBusy(false)
    if (e) setError(e)
    else setSent(true)
  }

  if (!session) {
    return (
      <div className="space-y-3 px-1 py-1">
        {sent ? (
          <p className="text-[13px] leading-relaxed text-status-success font-medium">
            Check your email — the sign-in link is on its way!
          </p>
        ) : (
          <>
            <Field label="Work email">
              <TextInput
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@delta-ridge.com"
                inputMode="email"
                autoComplete="email"
              />
            </Field>
            {error && <p className="text-[12px] text-status-critical">{error}</p>}
            <Button full variant="primary" onClick={() => void send()} disabled={busy || !email.includes('@')}>
              {busy ? 'Sending…' : 'Sign In with Magic Link'}
            </Button>
            <p className="text-[11px] text-text-secondary text-center mt-3 leading-relaxed">
              <span className="font-semibold block mb-0.5">Looking for a password?</span>
              Delta Ridge uses secure, passwordless authentication. Enter your email above to receive a magic link, or check your phone messages.
            </p>
          </>
        )}
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

