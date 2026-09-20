import { useState } from 'react'
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
}

function summarise(stalled: OutboxItem[]): string {
  const counts = new Map<string, number>()
  for (const item of stalled) counts.set(LABEL[item.entity], (counts.get(LABEL[item.entity]) ?? 0) + 1)
  return [...counts.entries()].map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')
}

export default function SyncPanel() {
  const { session, membership } = useSession()
  const { pending, stalled, running, syncNow, retryFailed } = useSync()
  const [showDetail, setShowDetail] = useState(false)

  // Nothing queued and nothing stuck is not worth a card on the rep's home
  // screen. The header pill already says "Saved on device".
  if (pending === 0 && stalled.length === 0) return null

  const blocked = !session ? 'signed out' : !membership ? 'no organization' : null

  return (
    <>
      <SectionTitle {...(running ? { hint: 'syncing…' } : {})}>SYNC</SectionTitle>
      <Card className={stalled.length > 0 ? '!bg-amber-500/8 ring-amber-500/20' : ''}>
        {stalled.length > 0 ? (
          <>
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
          </>
        ) : (
          <>
            <p className="text-[13.5px]">
              {pending} item{pending === 1 ? '' : 's'} waiting to sync.
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/45">
              {blocked === 'signed out'
                ? 'Saved on this device. Sign in above and it will go up on its own.'
                : blocked === 'no organization'
                  ? 'Saved on this device. Your account is not attached to an organization yet, so there is nowhere to send it.'
                  : 'Saved on this device and going up in the background.'}
            </p>
            {!blocked && (
              <Button variant="secondary" full className="mt-3" onClick={() => void syncNow()} disabled={running}>
                {running ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
          </>
        )}
      </Card>
    </>
  )
}
