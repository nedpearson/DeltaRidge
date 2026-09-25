import { useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { consentTally, type ManagedLead } from '@/features/leads/pipeline'

/**
 * Why there is no "text everyone" button, stated rather than implied.
 *
 * Sending marketing texts to a list of homeowners is not a feature, it is a
 * regulated activity. Under the TCPA the sender needs prior express written
 * consent for marketing messages, and US carriers additionally require a
 * registered 10DLC brand and campaign before they will deliver application-to-
 * person traffic at all — unregistered traffic is filtered or blocked.
 *
 * None of that exists here yet, and the honest thing is a checklist that says
 * so. A bulk send button that worked would be the dangerous outcome: it is the
 * one feature in this app that can generate liability per message.
 *
 * What DOES work is one person at a time, from the rep's own phone, to someone
 * who said yes — which is how a roofing rep actually follows up anyway.
 */

interface Requirement {
  label: string
  detail: string
  met: boolean
}

export default function MessagingReadiness({ leads }: { leads: readonly ManagedLead[] }) {
  const [open, setOpen] = useState(false)
  const tally = consentTally(leads)

  const requirements: Requirement[] = [
    {
      label: 'Recorded consent per person',
      detail:
        tally.total === 0
          ? 'No leads yet. Permission is captured on each lead as you work it.'
          : `${tally.sms} of ${tally.total} leads have said you may text them; ${tally.call} may be called.`,
      met: tally.total > 0 && tally.sms > 0,
    },
    {
      label: 'A suppression list that is actually enforced',
      detail:
        `${tally.optedOut} ${tally.optedOut === 1 ? 'person has' : 'people have'} asked not to be ` +
        'contacted. An opt-out clears every permission on that lead and the call and text buttons ' +
        'go dead.',
      met: true,
    },
    {
      label: 'A registered 10DLC brand and campaign',
      detail:
        'US carriers filter or block unregistered application-to-person traffic. Registration is ' +
        'done with a messaging provider and takes days, not minutes.',
      met: false,
    },
    {
      label: 'A sending provider with delivery receipts',
      detail:
        'Nothing here can send a message. The Text button hands the number to your own phone, ' +
        'which is why it records the text as initiated and never as delivered.',
      met: false,
    },
    {
      label: 'Automatic STOP and HELP handling',
      detail:
        'A reply of STOP has to suppress that number immediately, without anyone reading it. That ' +
        'needs an inbound webhook, which needs a provider.',
      met: false,
    },
    {
      label: 'Written consent, not verbal',
      detail:
        'What this app can witness is somebody saying yes at a door. Marketing messages need prior ' +
        'express WRITTEN consent, which is a form they sign, not a tick a rep makes.',
      met: false,
    },
  ]

  const missing = requirements.filter((r) => !r.met).length

  return (
    <>
      <SectionTitle hint={`${missing} of ${requirements.length} missing`}>
        BULK MESSAGING
      </SectionTitle>
      <Card className="!py-3">
        <p className="text-[12.5px] leading-relaxed text-[var(--color-ink)]/">
          There is no send-to-everyone button, and that is deliberate. One at a time, from your own
          phone, to someone who said yes — that works today.
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 w-full !min-h-0 py-1 text-[11px] text-[var(--color-ink)]/"
        >
          {open ? 'Hide what bulk sending would need' : 'What bulk sending would need'}
        </button>
        {open && (
          <ul className="mt-1 space-y-2.5 border-t border-slate-300 pt-3">
            {requirements.map((r) => (
              <li key={r.label} className="flex gap-2.5">
                <span
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${
                    r.met ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                <div>
                  <p className="text-[12.5px] font-semibold text-[var(--color-ink)]/">{r.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-ink)]/">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
