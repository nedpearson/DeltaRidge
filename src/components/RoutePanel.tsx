import { useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { useRouteTracking } from '@/features/routes/useRouteTracking'
import { trackedSeconds, walkedMeters } from '@/features/routes/tracking'

/**
 * Start and stop a work route, and say plainly what that means.
 *
 * The copy here is part of the feature. A rep who does not know when their
 * phone is recording their location will either not use this or will resent it,
 * and both are worse than not building it. So: nothing starts on its own, the
 * card says what is happening while it is happening, and stopping is one tap
 * from anywhere the panel is visible.
 */

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} hr ${m % 60} min`
}

function miles(meters: number): string {
  return `${(meters / 1609.344).toFixed(1)} mi`
}

export default function RoutePanel() {
  const { session, points, problem, start, stop, starting } = useRouteTracking()
  const [confirmStop, setConfirmStop] = useState(false)

  if (!session) {
    return (
      <>
        <SectionTitle>ROUTE</SectionTitle>
        <Card>
          <p className="text-[13.5px]">Not recording.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            Starting a route records where you walk until you stop it, so a knock can be checked against where
            the phone actually was. Nothing is recorded before you start or after you stop.
          </p>
          <Button variant="gold" full className="mt-3" disabled={starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start route'}
          </Button>
        </Card>
      </>
    )
  }

  const walked = walkedMeters(points)
  const tracked = trackedSeconds(points)

  return (
    <>
      <SectionTitle hint="recording">ROUTE</SectionTitle>
      <Card className="!bg-emerald-500/8 ring-emerald-500/20">
        <p className="text-[13.5px] font-semibold text-emerald-200">Recording your route.</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[17px] font-semibold">{duration(tracked)}</p>
            <p className="text-[10.5px] uppercase tracking-wide text-white/35">tracked</p>
          </div>
          <div>
            <p className="text-[17px] font-semibold">{miles(walked)}</p>
            <p className="text-[10.5px] uppercase tracking-wide text-white/35">walked</p>
          </div>
          <div>
            <p className="text-[17px] font-semibold">{points.length}</p>
            <p className="text-[10.5px] uppercase tracking-wide text-white/35">fixes</p>
          </div>
        </div>

        {/*
          Walked distance excludes gaps in the trail on purpose. Saying so here
          rather than only in the code, because this is the number somebody will
          eventually quote at a rep.
        */}
        <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
          Walked counts only stretches the phone actually recorded. Gaps are left out rather than guessed at.
        </p>

        {problem && <p className="mt-2 text-[12px] leading-relaxed text-amber-200/80">{problem}</p>}

        {confirmStop ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>
              Keep going
            </Button>
            <Button
              variant="gold"
              onClick={() => {
                setConfirmStop(false)
                void stop()
              }}
            >
              Stop recording
            </Button>
          </div>
        ) : (
          <Button variant="secondary" full className="mt-3" onClick={() => setConfirmStop(true)}>
            Stop route
          </Button>
        )}
      </Card>
    </>
  )
}
