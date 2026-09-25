import type { ReactNode } from 'react'
import { Button } from '@/components/ui'

/**
 * The four things a rep does on a driveway, above everything else on the page.
 *
 * This is a relocation, not an invention: the call and text buttons already
 * existed on the lead screen, three screenfuls down, under the property
 * metadata. A rep who has to scroll past year-built and permit history to reach
 * the phone number is a rep who stops using the app. The target is open lead ->
 * see owner -> call, inside five seconds.
 *
 * WHAT THIS DOES NOT DO, and why it matters more than what it does:
 *
 * A blocked action is never a dead grey rectangle. Every refusal shows its
 * reason, in the same place the button would have been, because "why is Call
 * greyed out" is otherwise a support call — and because the reasons here are
 * legal ones a rep genuinely needs to know. Calling outside Louisiana's 8am-8pm
 * window, or dialling a number the homeowner never gave us, is a real penalty,
 * not a UI state.
 *
 * It also never claims more than it can see. The buttons hand the number to the
 * phone's own dialler and lose sight of it there, so the activity recorded is
 * "call placed", never "call answered"; "text initiated", never "text sent".
 */

export interface ContactAvailability {
  readonly allowed: boolean
  /** Shown to the rep when not allowed. Required, because a silent refusal is worse. */
  readonly reason: string | null
}

function Action({
  label,
  href,
  onClick,
  availability,
  tone = 'secondary',
}: {
  label: string
  href: string | null
  onClick?: (() => void) | undefined
  availability: ContactAvailability
  tone?: 'secondary' | 'gold' | undefined
}) {
  if (!availability.allowed || href === null) {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="secondary" disabled aria-describedby={`why-${label}`}>
          {label}
        </Button>
        {availability.reason !== null && (
          <p id={`why-${label}`} className="text-[10.5px] leading-tight text-amber-700/70">
            {availability.reason}
          </p>
        )}
      </div>
    )
  }
  return (
    <a href={href} className="contents" {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
      <Button variant={tone} onClick={onClick}>
        {label}
      </Button>
    </a>
  )
}

export default function ContactActions({
  phone,
  phoneNote,
  email,
  latitude,
  longitude,
  call,
  text,
  onCall,
  onText,
  onEmail,
  children,
}: {
  phone: string | null
  /** Where the number came from, in words. Never a confidence score we do not have. */
  phoneNote: string | null
  email: string | null
  latitude: number
  longitude: number
  call: ContactAvailability
  text: ContactAvailability
  onCall?: (() => void) | undefined
  onText?: (() => void) | undefined
  onEmail?: (() => void) | undefined
  children?: ReactNode | undefined
}) {
  const noPhone: ContactAvailability = { allowed: false, reason: 'No number on this lead' }

  return (
    /*
     * Sticky under the app header rather than fixed to the bottom: the bottom
     * belongs to the navigation, and a second fixed bar down there is how the
     * two end up on top of each other on a small phone.
     */
    <div className="sticky top-[57px] z-10 -mx-4 mb-3 border-b border-slate-300 bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur">
      {phone !== null ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {/* A phone number is a thing people read aloud and type; it gets to be
              big, and it never truncates. */}
          <a
            href={call.allowed ? `tel:${phone}` : undefined}
            onClick={call.allowed ? onCall : undefined}
            className="text-[19px] font-semibold tracking-tight text-[var(--color-ink)]"
          >
            {phone}
          </a>
          {phoneNote !== null && (
            <span className="text-[11.5px] text-[var(--color-ink)]/">{phoneNote}</span>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--color-ink)]/">No phone number on this lead yet.</p>
      )}

      {email !== null && (
        <p className="mt-0.5 break-all text-[12.5px] text-[var(--color-ink)]/">{email}</p>
      )}

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Action
          label="Call"
          href={phone === null ? null : `tel:${phone}`}
          onClick={onCall}
          availability={phone === null ? noPhone : call}
          tone="gold"
        />
        <Action
          label="Text"
          href={phone === null ? null : `sms:${phone}`}
          onClick={onText}
          availability={phone === null ? noPhone : text}
        />
        {/*
          Navigate carries no compliance gate and never will. Driving to a house
          is not soliciting anybody, and a rep who cannot find the address is no
          safer for it.
        */}
        <Action
          label="Navigate"
          href={`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`}
          availability={{ allowed: true, reason: null }}
        />
      </div>

      {email !== null && (
        <div className="mt-2">
          <Action
            label="Email"
            href={`mailto:${email}`}
            onClick={onEmail}
            availability={{ allowed: true, reason: null }}
          />
        </div>
      )}

      {children}
    </div>
  )
}
