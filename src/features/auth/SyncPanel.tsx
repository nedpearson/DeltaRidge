import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useSync } from './useSync'
import { useSession } from './session'
import type { OutboxItem } from '@/lib/db'

/**
 * What the sync queue is actually doing, in words a rep can act on.
 *
 * The rule here is the one from the brief: never "Something went wrong". Every
 * state below says what is safe, what is stuck, and what the rep can do about
 * it. Silence is the failure mode this panel exists to prevent.
 *
 * Four states, in the order they matter to the person holding the phone:
 * something failed for good, the sign-in expired, this phone is holding someone
 * else's day, and the ordinary "on its way".
 */

const LABEL: Record<OutboxItem['entity'], string> = {
  inspection: 'Inspection',
  photo: 'Photo',
  observation: 'Note',
  voiceNote: 'Voice note',
  handoff: 'Office package',
  lead: 'Lead',
  leadActivity: 'Lead contact',
  leadAttachment: 'Lead recording',
  routeSession: 'Work route',
  routePoint: 'Route location',
}

function summarise(stalled: OutboxItem[]): string {
  const counts = new Map<string, number>()
  for (const item of stalled) counts.set(LABEL[item.entity], (counts.get(LABEL[item.entity]) ?? 0) + 1)
  return [...counts.entries()].map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')
}

export default function SyncPanel() {
  const { session, membership } = useSession()
  const { pending, stalled, foreign, blocked, running, syncNow, retryFailed } = useSync()
  const [showDetail, setShowDetail] = useState(false)

  // Nothing queued and nothing stuck is not worth a card on the rep's home
  // screen. The header pill already says "Saved on device".
  if (pending === 0 && stalled.length === 0) return null

  const signedOut = !session
  const noOrg = Boolean(session) && !membership
  // Work queued under this sign-in that is genuinely on its way, as opposed to
  // failed, auth-blocked, or someone else's. Reported separately so the panel
  // never says "3 waiting" when all three are another rep's.
  const mine = Math.max(0, pending - stalled.length - foreign)

  return (
    <>
      <SectionTitle {...(running ? { hint: 'syncing…' } : {})}>SYNC</SectionTitle>

      {stalled.length > 0 && (
        <Card className="!bg-amber-500/8 ring-amber-500/20">
          <p className="text-[13.5px] font-semibold text-amber-200">
            {summarise(stalled)} could not be sent.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-100/70">
            Everything is still saved on this device — nothing has been lost. The app has stopped retrying on its
            own so it is not draining your battery on a request that keeps failing.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? 'Hide detail' : 'What failed'}
            </Button>
            <Button variant="gold" onClick={() => void retryFailed()} disabled={running}>
              Try again
            </Button>
          </div>
          {showDetail && (
            <ul className="mt-3 space-y-2 border-t border-white/8 pt-3">
              {stalled.map((item) => (
                <li key={item.id} className="text-[12px] leading-relaxed">
                  <span className="font-semibold text-white/70">{LABEL[item.entity]}</span>
                  <span className="text-white/35"> · {item.attempts} attempts</span>
                  <p className="mt-0.5 break-words text-white/45">{item.lastError ?? 'No error recorded.'}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {blocked > 0 && (
        <Card className="mt-2 !bg-sky-500/8 ring-sky-500/20">
          <p className="text-[13.5px] font-semibold text-sky-200">
            {blocked} item{blocked === 1 ? '' : 's'} need you to sign in again.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-sky-100/70">
            Your sign-in expired while you were working. Nothing was lost and nothing has been retried against a
            dead session — it goes up on its own the moment you are back in.
          </p>
        </Card>
      )}

      {foreign > 0 && (
        <Card className="mt-2">
          <p className="text-[13.5px] font-semibold text-white/80">
            {foreign} item{foreign === 1 ? '' : 's'} on this phone belong to another sign-in.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            They are safe and they are not being sent under your account. Whoever captured them can sign in on this
            phone and they will go up under their own name.
          </p>
        </Card>
      )}

      {mine > 0 && (
        <Card className="mt-2">
          <p className="text-[13.5px]">
            {mine} field update{mine === 1 ? '' : 's'} waiting to sync.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            {signedOut
              ? 'Saved on this device. Sign in above and it will go up on its own.'
              : noOrg
                ? 'Saved on this device. Your account is not attached to an organization yet, so there is nowhere to send it.'
                : !navigator.onLine
                  ? 'Saved on this device. No connection right now — it goes up as soon as there is one.'
                  : 'Saved on this device and going up in the background.'}
          </p>
          {!signedOut && !noOrg && (
            <Button variant="secondary" full className="mt-3" onClick={() => void syncNow()} disabled={running}>
              {running ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </Card>
      )}

      <Link to="/diagnostics" className="mt-2 block text-center text-[11.5px] text-white/35 underline">
        Sync diagnostics
      </Link>
    </>
  )
}
