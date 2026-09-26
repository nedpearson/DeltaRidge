import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DoorOutcomeSheet from '@/components/DoorOutcomeSheet'
import LeadMap from '@/components/LeadMap'
import MessagingReadiness from '@/components/MessagingReadiness'
import { OwnerLine } from '@/components/OwnerLine'
import RoofViewSheet from '@/components/RoofViewSheet'
import ResidentPhoneCard from '@/components/ResidentPhoneCard'
import { saveResidentContact } from '@/features/leads/contact-enrichment'
import { Button, Card, Empty, Field, SectionTitle, Select } from '@/components/ui'
import RoutePanel from '@/components/RoutePanel'
import { evidenceFor } from '@/features/routes/knock-evidence'
import { openSessionId } from '@/features/routes/route-store'
import { observationOf, type StormCoverage } from '@/features/leads/coverage'
import {
  DEFAULT_SETTINGS,
  ENGINE_VERSION,
  readCachedRun,
  runLeadEngine,
  type LeadRun,
  type LeadRunSettings,
} from '@/features/leads/engine'
import { byAddress, promote, readLeads, saveOutcome, suppressedKeys } from '@/features/leads/lead-store'
import {
  applyOutcome,
  chipCounts,
  dueLabel,
  isDue,
  STATUS_LABEL,
  type ApplyOptions,
  type DoorOutcome,
  mayContact,
  type ManagedLead,
} from '@/features/leads/pipeline'
import { mayCallAt } from '@/features/compliance/engine'
import { ALL_SOLICITATION_RULES } from '@/features/compliance/solicitation'
import {
  groupIntoRoutes,
  orderForWalking,
  splitRoutes,
  walkingMiles,
  type Route,
} from '@/features/leads/routes'
import type { ScoredLead } from '@/features/leads/scoring'
import {
  optimizeDoorRoute,
  routeMethodLabel,
  type RouteOptimization,
} from '@/features/leads/route-optimization'
import { intelligenceFor, INTELLIGENCE_LEVEL_LABEL } from '@/features/leads/lead-intelligence'
import LeadProofPanel from '@/features/leads/LeadProofPanel'
import AppointmentBriefPanel from '@/features/leads/AppointmentBriefPanel'
import { WINDOW_OPTIONS, type StormWindowKey } from '@/features/leads/window'
import { bboxAround, type SearchCenter } from '@/features/leads/search-area'
import type { StormEvent } from '@/integrations/storm'
import { newId, saveInspection, type LocalInspection } from '@/lib/db'
import { currentPosition } from '@/lib/image'

/**
 * Custom ranges are deliberately absent until there is a date picker to set
 * them with. An option that silently falls back to 24 months would be worse
 * than not offering it.
 */
const SELECTABLE_WINDOWS = WINDOW_OPTIONS.filter((w) => w.key !== 'custom')

/**
 * The door list, and what happens to a door afterwards.
 *
 * A generated list of 150 addresses is a canvassing route. The moment a rep
 * speaks to someone it stops being a row tomorrow's run will regenerate and
 * becomes a record with a history — that is what the four tabs across the top
 * are counting.
 *
 * Every door still states why it is on the list, because a rep who cannot
 * explain the ranking will not trust it. There is no percentage and no "AI
 * score" here: with no closed-won history in the system yet, a probability
 * would be invented.
 */

type Tab = 'new' | 'follow_up' | 'need_visit' | 'appointments'

/**
 * How stale the cached list may be before the page rebuilds it on its own.
 *
 * The list used to sit at whatever it was when it was last built by hand, so a
 * rep who opened the app in the morning was looking at last week's storms and
 * had no way to know it. Both upstream feeds are live — the parish permit feed
 * updates daily and NWS reports land within minutes of a storm — so the only
 * thing that was stale was us.
 */
const MAX_CACHE_AGE_MS = 30 * 60 * 1000

/** How often an open page re-checks whether its list has gone stale. */
const POLL_MS = 5 * 60 * 1000

/** "built 12 min ago" — days are too coarse once the list rebuilds itself. */
function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return relativeDay(iso)
}

function relativeDay(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function tone(score: number): string {
  if (score >= 60) return 'text-brand-primary'
  if (score >= 40) return 'text-brand-gold'
  return 'text-text-secondary'
}

function mapsHref(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}

/** A door nobody has spoken to yet. */
function DoorCard({
  lead,
  managed,
  onKnock,
  onPhoneSaved,
}: {
  lead: ScoredLead
  managed: ManagedLead | undefined
  onKnock: (lead: ScoredLead) => void
  onPhoneSaved?: () => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [roofOpen, setRoofOpen] = useState(false)
  const parcel = lead.parcel
  const intel = intelligenceFor(lead, managed)

  return (
    <Card>
      {roofOpen && (
        <RoofViewSheet
          latitude={lead.latitude}
          longitude={lead.longitude}
          address={lead.address}
          onClose={() => setRoofOpen(false)}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{lead.address}</p>
          <p className="mt-0.5 truncate text-[12px] text-text-secondary">
            {[lead.subdivision, lead.city].filter(Boolean).join(' · ') || 'East Baton Rouge Parish'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-display text-2xl leading-none ${tone(lead.score)}`}>{lead.score}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-text-secondary">priority</p>
        </div>
      </div>

      <OwnerLine parcel={parcel} />

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <div className="rounded-xl bg-bg-page px-2 py-2 text-center ring-1 ring-border-subtle">
          <p className="font-display text-[16px] leading-none text-brand-gold">{intel.propertyOpportunity}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-text-muted">Opportunity</p>
        </div>
        <div className="rounded-xl bg-bg-page px-2 py-2 text-center ring-1 ring-border-subtle">
          <p className="font-display text-[16px] leading-none text-status-ai">{intel.intent}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-text-muted">Intent</p>
        </div>
        <div className="rounded-xl bg-bg-page px-2 py-2 text-center ring-1 ring-border-subtle">
          <p className="font-display text-[16px] leading-none text-route-live">{intel.contactability}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-text-muted">Contact</p>
        </div>
      </div>
      <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
        {INTELLIGENCE_LEVEL_LABEL[intel.level]}
      </p>

      <ResidentPhoneCard
        address={lead.address}
        city={lead.city || 'Baton Rouge'}
        zip={lead.postalCode}
        ownerName={parcel?.ownerName}
        phone={managed?.contactPhone}
        email={managed?.contactEmail}
        onPhoneSaved={async (phone, email, name, source) => {
          await saveResidentContact(lead, phone, email, name, source ?? 'unknown')
          onPhoneSaved?.()
        }}
      />

      {managed && (
        <p className="mt-2 inline-block rounded-full bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary">
          {STATUS_LABEL[managed.status]} · knocked {managed.knockCount}x
        </p>
      )}

      <ul className="mt-2.5 space-y-1">
        {lead.reasons.map((reason) => (
          <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-text-secondary">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
            {reason}
          </li>
        ))}
      </ul>

      {/* Knocking is the only thing this app asks a rep to do at a door, and it
          is the widest target on the card for that reason. Navigate and the
          full profile sit under it rather than competing with it. */}
      <Button variant="gold" full className="mt-3" onClick={() => onKnock(lead)}>
        Knocked it
      </Button>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <a
          href={mapsHref(lead.latitude, lead.longitude)}
          target="_blank"
          rel="noreferrer"
          className="contents"
        >
          <Button variant="secondary">Navigate</Button>
        </a>
        <Button
          variant="secondary"
          onClick={() => setRoofOpen(true)}
        >
          EagleView
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate(`/property/${encodeURIComponent(lead.addressKey)}`)}
        >
          Property
        </Button>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full !min-h-0 py-1 text-[11px] text-text-secondary"
      >
        {open ? 'Hide why this house' : 'Why this house / show proof'}
      </button>
      {open && (
        <>
          <LeadProofPanel scored={lead} {...(managed ? { managed } : {})} />
          <ScoreBreakdown lead={lead} />
        </>
      )}
    </Card>
  )
}

/**
 * A neighbourhood worth driving to.
 *
 * Deliberately leads with the best door in the route rather than the count.
 * A rep does not drive across town for "forty doors"; he drives for the one
 * that is worth the trip, and the other thirty-nine are why he stays once he
 * is parked.
 */
function RouteCard({ route, onPick }: { route: Route; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="w-full rounded-2xl bg-bg-card/[0.04] p-4 text-left ring-1 ring-border-subtle"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold">{route.name}</p>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {route.doors.length} door{route.doors.length === 1 ? '' : 's'}
            {route.milesAway !== undefined && ` · ${route.milesAway} mi away`}
            {route.spreadMiles > 0 && ` · about ${route.spreadMiles} mi across`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-display text-xl leading-none ${tone(route.topScore)}`}>
            {route.topScore}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-text-secondary">best door</p>
        </div>
      </div>
    </button>
  )
}

/**
 * The header once a route is picked.
 *
 * The walking distance is stated plainly, and so is what the ordering is: a
 * greedy nearest-neighbour path between points, which is not an optimal route
 * and knows nothing about one-way streets or which side of the road a house is
 * on. A rep who is told "optimised" and then sent across a canal stops trusting
 * the app; a rep who is told "shortest walk between the dots" knows what he has.
 */
function RouteHeader({
  route,
  ordered,
  optimization,
  optimizing,
  onRetry,
  onBack,
}: {
  route: Route
  ordered: readonly ScoredLead[]
  optimization: RouteOptimization | null
  optimizing: boolean
  onRetry: () => void
  onBack: () => void
}) {
  const straightLineMiles = walkingMiles(ordered)
  const routeMiles =
    optimization?.distanceMeters != null
      ? optimization.distanceMeters / 1609.344
      : null
  const routeMinutes =
    optimization?.durationSeconds != null
      ? Math.max(1, Math.round(optimization.durationSeconds / 60))
      : null

  return (
    <Card className="!py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold">{route.name}</p>
          <p className="mt-0.5 text-[11.5px] text-text-secondary">
            {ordered.length} door{ordered.length === 1 ? '' : 's'}
            {routeMiles !== null
              ? ` · ${routeMiles.toFixed(1)} road mi`
              : straightLineMiles > 0
                ? ` · about ${straightLineMiles} mi point-to-point`
                : ''}
            {routeMinutes !== null ? ` · about ${routeMinutes} min` : ''}
          </p>
        </div>
        <Button variant="secondary" className="shrink-0 !min-h-0 !px-3 !py-1.5" onClick={onBack}>
          All routes
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-bg-page px-3 py-2 ring-1 ring-border-subtle">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Route method
          </p>
          <p className="mt-0.5 text-[11.5px] text-text-secondary">
            {optimizing
              ? 'Calculating street-aware walking order…'
              : optimization
                ? routeMethodLabel(optimization.method)
                : 'Local nearest-door order'}
          </p>
        </div>
        {!optimizing && (
          <Button variant="ghost" className="shrink-0 !min-h-0 !px-2.5 !py-1.5" onClick={onRetry}>
            Recalculate
          </Button>
        )}
      </div>

      {optimization?.warning ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-status-warning">
          {optimization.warning}
        </p>
      ) : optimization?.method === 'mapbox_exact' ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
          Mapbox optimized this route against the walking street network, starting from your current GPS fix.
          Road data can still differ from temporary closures or private access conditions.
        </p>
      ) : (
        <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
          The fallback order uses property coordinates only. It does not know one-way streets,
          cul-de-sacs, sidewalks, gates, or temporary closures.
        </p>
      )}
    </Card>
  )
}

/**
 * How far apart these doors actually are.
 *
 * Worth saying out loud, because the honest answer is "not very". The
 * candidate filter has already required an old roof, under a storm, with no
 * re-roof permit since — so by the time a door reaches this list, three of the
 * six scoring terms are close to constant across the whole list. On a real run
 * the scores landed in a thirteen-point band.
 *
 * A rep reading a column of near-identical numbers will either assume the
 * ranking is broken or assume it means more than it does. Naming the band and
 * what actually separates the ends is cheaper than pretending to a precision
 * the data does not support.
 */
function ScoreSpread({ doors }: { doors: readonly ScoredLead[] }) {
  if (doors.length < 2) return null
  const scores = doors.map((d) => d.score)
  const low = Math.min(...scores)
  const high = Math.max(...scores)
  if (high - low > 30) return null

  return (
    <Card className="!py-2.5">
      <p className="text-[11.5px] leading-relaxed text-text-secondary">
        Priority runs {low}–{high} across this list. Every door here already has an old roof under
        a storm with no re-roof permit since, so what separates the top from the bottom is mostly{' '}
        <span className="text-text-secondary">job size and how close the hail fell</span> — not whether
        the door is worth knocking. They all are.
      </p>
    </Card>
  )
}

/**
 * The score, itemised.
 *
 * Shown as signed points rather than raw measurements, because "1.75 inches"
 * does not tell a rep why this door beat the one below it and "+28" does. The
 * numbers come off the lead itself so the column always adds to the headline —
 * deriving them here is how a card ends up showing 84 above a column of 79.
 */
function ScoreBreakdown({ lead }: { lead: ScoredLead }) {
  return (
    <div className="mt-1 border-t border-border-subtle pt-2">
      <ul className="space-y-1">
        {lead.breakdown.map((factor) => (
          <li key={factor.label} className="flex items-baseline gap-2 text-[12px]">
            <span className="w-9 shrink-0 text-right font-display text-gold-400">
              +{factor.points}
            </span>
            <span className="min-w-0 flex-1 text-text-secondary">
              {factor.label}
              <span className="text-text-secondary"> — {factor.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-baseline gap-2 border-t border-border-subtle pt-1.5 text-[12px]">
        <span className="w-9 shrink-0 text-right font-display text-text-secondary">{lead.score}</span>
        <span className="text-text-secondary">Priority</span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-secondary">
        Weights are hand-set, not learned. This ranks documentation-worthy opportunity, not the
        chance of a sale — there is no closed-won history in this system yet to learn one from.
      </p>

      <div className="mt-2 border-t border-border-subtle pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Proof</p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-text-secondary">
          <li>
            Storm: {lead.storm.provider.toUpperCase()} · {lead.storm.observation === 'radar_estimate' ? 'radar estimate' : 'official report'} · {shortDate(lead.storm.occurredAt)}
          </li>
          <li>
            Roof age basis: {lead.roofPermit.provider.toUpperCase()} permit · {shortDate(lead.roofPermit.issuedAt)}
          </li>
          {lead.parcel && (
            <li>
              Owner/property basis: {lead.parcel.provider.toUpperCase()} assessor record · retrieved {shortDate(lead.parcel.retrievedAt)}
            </li>
          )}
        </ul>
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
          Nearby storm evidence is not proof that hail struck this specific roof. Current condition still requires suitable imagery or inspection evidence.
        </p>
      </div>
    </div>
  )
}

/** A door that has become somebody. */
function PipelineCard({ lead, now, scored }: { lead: ManagedLead; now: string; scored?: ScoredLead }) {
  const navigate = useNavigate()
  const due = dueLabel(lead, now)
  const overdue = isDue(lead, now)

  /*
   * The same gates the lead screen uses, not a looser version for the list.
   * A card that offers Call on a number the lead screen refuses to dial would
   * be a way around the compliance rules rather than a shortcut through them.
   */
  const callWindow = mayCallAt(
    ALL_SOLICITATION_RULES,
    { state: 'LA', parish: 'East Baton Rouge', municipality: null },
    new Date(),
  )
  const callable =
    lead.contactPhone !== undefined &&
    callWindow.allowed &&
    mayContact(lead, 'call').allowed
      ? lead.contactPhone
      : null

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{lead.contactName ?? lead.address}</p>
          <p className="mt-0.5 truncate text-[12px] text-text-secondary">
            {lead.contactName
              ? lead.address
              : [lead.subdivision, lead.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        {due && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
              overdue ? 'bg-gold-500/20 text-gold-300' : 'bg-bg-elevated text-text-secondary'
            }`}
          >
            {due}
          </span>
        )}
      </div>

      <p className="mt-2 text-[12px] text-text-secondary">
        {STATUS_LABEL[lead.status]} · knocked {lead.knockCount}x · added {relativeDay(lead.createdAt)}
      </p>

      {/*
        Call and text straight off the card, so chasing a follow-up costs one tap
        instead of three. The number only appears when there is one AND the
        compliance gates pass — a card is not the place to explain a calling
        window, so a blocked number simply does not offer the button and the
        reason waits on the lead screen.
      */}
      {callable !== null && (
        <div className="mt-3 flex items-center gap-2">
          <a href={`tel:${callable}`} className="contents">
            <Button variant="secondary">Call</Button>
          </a>
          <a href={`sms:${callable}`} className="contents">
            <Button variant="secondary">Text</Button>
          </a>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={mapsHref(lead.latitude, lead.longitude)}
          target="_blank"
          rel="noreferrer"
          className="contents"
        >
          <Button variant="secondary">Navigate</Button>
        </a>
        <Button variant="gold" onClick={() => navigate(`/lead/${lead.id}`)}>
          Open lead
        </Button>
      </div>
      <AppointmentBriefPanel lead={lead} {...(scored ? { scored } : {})} />
    </Card>
  )
}

/**
 * What the storm data is, source by source.
 *
 * The page used to print one number. One number cannot answer "is this all the
 * hail there was, or is the app not looking properly?", which is the only
 * question worth asking when the list looks thin. So each source is reported
 * separately and the one that is not running is named.
 */
function CoveragePanel({ coverage, events }: { coverage: StormCoverage; events: StormEvent[] }) {
  const [open, setOpen] = useState(false)
  const official = coverage.official

  return (
    <>
      <SectionTitle hint={coverage.window.label}>STORM DATA</SectionTitle>
      <Card className="!py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-text-secondary">Official ground reports</p>
          {official.kind === 'live' ? (
            <p className="shrink-0 font-display text-[15px] text-status-success">{official.count}</p>
          ) : (
            <p className="shrink-0 text-[11px] uppercase tracking-wider text-status-warning">
              {official.kind === 'failed' ? 'unavailable' : 'off'}
            </p>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
          NWS Local Storm Reports — someone on the ground reported hail and the NWS logged it.
          {official.kind === 'live' && official.newestAt
            ? ` Most recent: ${shortDate(official.newestAt)}.`
            : ''}
          {official.kind === 'failed' ? ` ${official.why}` : ''}
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
          <p className="text-[13px] text-text-secondary">Radar-estimated hail (NEXRAD)</p>
          {coverage.radar.kind === 'live' ? (
            <p className="shrink-0 font-display text-[15px] text-status-success">
              {coverage.radar.count}
            </p>
          ) : (
            <p className="shrink-0 text-[11px] uppercase tracking-wider text-status-warning">
              {coverage.radar.kind === 'failed' ? 'unavailable' : 'not configured'}
            </p>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
          {coverage.radar.kind === 'live'
            ? (coverage.radar.note ?? 'Radar-estimated hail is running.')
            : coverage.radar.why}
          {coverage.radar.kind === 'live' && coverage.radar.newestAt
            ? ` Most recent: ${shortDate(coverage.radar.newestAt)}.`
            : ''}
        </p>

        {coverage.byYear.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
            {coverage.byYear.map((y) => (
              <span
                key={y.year}
                className="rounded-full bg-bg-elevated px-2.5 py-1 text-[11px] text-text-secondary"
              >
                {y.year} · {y.count}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 w-full !min-h-0 py-1 text-[11px] text-text-secondary"
        >
          {open ? 'Hide storms' : `View ${events.length} storm${events.length === 1 ? '' : 's'}`}
        </button>
        {open && (
          <ul className="mt-1 space-y-1.5 border-t border-border-subtle pt-2">
            {events.length === 0 && (
              <li className="text-[11.5px] leading-relaxed text-text-secondary">
                Nothing qualified in this window. That is the feed answering, not the feed failing.
              </li>
            )}
            {[...events]
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .map((e) => (
                <li key={e.externalId} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-text-secondary">
                      {[e.city, e.countyParish].filter(Boolean).join(', ') ||
                        // A radar detection is a grid square, not a town. Its
                        // coordinates are the only honest name it has.
                        `${e.latitude.toFixed(2)}, ${e.longitude.toFixed(2)}`}
                    </p>
                    {/*
                      The source is per-event, never assumed. This line used to
                      read "official report" for everything, which was true
                      until radar landed and would have mislabelled every radar
                      estimate the moment it did.
                    */}
                    <p className="text-[10.5px] text-text-secondary">
                      {shortDate(e.occurredAt)} ·{' '}
                      {observationOf(e) === 'official_report'
                        ? 'official report'
                        : e.radarConfidence === 'corroborated'
                          ? 'radar estimate, report nearby'
                          : 'radar estimate only'}
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-[13px] text-gold-400">
                    {e.hailSizeInches !== undefined ? `${e.hailSizeInches}"` : '—'}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        active ? 'bg-gold-500 text-brand-950' : 'bg-bg-elevated text-text-secondary'
      }`}
    >
      {label}
      <span className={`font-display text-[13px] ${active ? 'text-brand-950' : 'text-text-secondary'}`}>
        {count}
      </span>
    </button>
  )
}

export default function LeadsPage() {
  const navigate = useNavigate()
  const [run, setRun] = useState<LeadRun | null>(null)
  const [managed, setManaged] = useState<ManagedLead[]>([])
  const [settings, setSettings] = useState<LeadRunSettings>(DEFAULT_SETTINGS)
  const [tab, setTab] = useState<Tab>('new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [knocking, setKnocking] = useState<ScoredLead | null>(null)
  const [showCompetitors, setShowCompetitors] = useState(false)
  const [routeName, setRouteName] = useState<string | null>(null)
  const [ownerOccupiedOnly, setOwnerOccupiedOnly] = useState(false)
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null)
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'ready' | 'unavailable'>('idle')
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)
  const [routeOptimization, setRouteOptimization] = useState<RouteOptimization | null>(null)
  const [routeOptimizing, setRouteOptimizing] = useState(false)

  const busyRef = useRef(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const ranAtRef = useRef<string | null>(null)
  ranAtRef.current = run?.ranAt ?? null

  /**
   * `auto` marks a rebuild the page decided on by itself. Those yield to a run
   * already in flight and never raise an error banner — a rep who is reading
   * the list must not have it replaced by "could not build the list" because a
   * background refresh hit a dead spot. A tap always runs and always reports.
   */
  const refresh = useCallback(async (next: LeadRunSettings, auto = false) => {
    if (auto && busyRef.current) return
    busyRef.current = true
    setBusy(true)
    if (!auto) setError(null)
    try {
      setRun(await runLeadEngine(next))
      setError(null)
    } catch (err) {
      if (!auto) {
        setError(
          err instanceof Error
            ? `Could not build the list: ${err.message}. Anything already downloaded is still below.`
            : 'Could not build the list. Anything already downloaded is still below.',
        )
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void readCachedRun().then((cached) => {
      if (cached) {
        setRun(cached)
        setSettings(cached.settings)
      }
      // Open the app, get today's list. The cache is there so the page paints
      // instantly and still works in a dead spot, not so it can be the answer.
      const age = cached ? Date.now() - new Date(cached.ranAt).getTime() : Infinity

      // Age is not the only way a cached run goes wrong. A run written by an
      // older engine can be minutes old and still describe a world that no
      // longer exists — radar hail shipped, the new bundle deployed, and the
      // panel kept saying NOT CONFIGURED because the cached run predated the
      // source. The rep has no way to tell that apart from the truth, so a run
      // from a different engine is stale however fresh it is.
      const fromOlderEngine = !cached || cached.engineVersion !== ENGINE_VERSION

      // A current-location run must not silently fall back to the company/service-area
      // bbox. Keep cached results visible, but wait for an actual GPS fix before
      // rebuilding them as "near me".
      if ((fromOlderEngine || age > MAX_CACHE_AGE_MS) && navigator.onLine && cached?.settings.searchCenter) {
        void refresh(cached.settings, true)
      }
    })
    void readLeads().then(setManaged)
  }, [refresh])

  /**
   * Keep it current while the page stays open: on a timer, when the truck comes
   * back into signal, and when the rep switches back to the app. All three are
   * age-gated, so waking the phone twenty times an hour costs nothing.
   */
  useEffect(() => {
    const rebuildIfStale = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      const ranAt = ranAtRef.current
      if (ranAt && Date.now() - new Date(ranAt).getTime() < MAX_CACHE_AGE_MS) return
      void refresh(settingsRef.current, true)
    }

    const timer = window.setInterval(rebuildIfStale, POLL_MS)
    document.addEventListener('visibilitychange', rebuildIfStale)
    window.addEventListener('online', rebuildIfStale)
    window.addEventListener('focus', rebuildIfStale)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', rebuildIfStale)
      window.removeEventListener('online', rebuildIfStale)
      window.removeEventListener('focus', rebuildIfStale)
    }
  }, [refresh])

  const now = new Date().toISOString()
  const suppressed = useMemo(() => suppressedKeys(managed), [managed])
  const managedByAddress = useMemo(() => byAddress(managed), [managed])

  /** Doors still worth walking up to: nothing suppressed, nothing already being worked. */
  const doors = useMemo(() => {
    if (!run) return []
    return run.leads.filter((l) => {
      if (suppressed.has(l.addressKey)) return false
      const existing = managedByAddress.get(l.addressKey)
      return existing === undefined || existing.status === 'new'
    })
  }, [run, suppressed, managedByAddress])

  /** What the rep can filter down to, before routes are built. */
  const filteredDoors = useMemo(
    () => (ownerOccupiedOnly ? doors.filter((d) => d.parcel?.occupancy === 'owner_occupied') : doors),
    [doors, ownerOccupiedOnly],
  )

  const routes = useMemo(
    () => groupIntoRoutes(filteredDoors, here ?? undefined),
    [filteredDoors, here],
  )

  const { worthADrive, singleStops } = useMemo(() => splitRoutes(routes), [routes])

  const activeRoute = useMemo(
    () => routes.find((r) => r.name === routeName) ?? null,
    [routes, routeName],
  )

  const localRouteOrder = useMemo(
    () => (activeRoute ? orderForWalking(activeRoute.doors, here ?? undefined) : filteredDoors),
    [activeRoute, filteredDoors, here],
  )

  const optimizeActiveRoute = useCallback(async () => {
    if (!activeRoute || !here) {
      setRouteOptimization(null)
      return
    }
    setRouteOptimizing(true)
    const result = await optimizeDoorRoute({
      start: here,
      doors: orderForWalking(activeRoute.doors, here),
      profile: 'walking',
    })
    setRouteOptimization(result)
    setRouteOptimizing(false)
  }, [activeRoute, here])

  useEffect(() => {
    setRouteOptimization(null)
    if (!activeRoute || !here) return
    void optimizeActiveRoute()
  }, [activeRoute, here, optimizeActiveRoute])

  /**
   * The doors actually on screen. When the server-side Mapbox optimizer is
   * available the street-aware order wins; otherwise the deterministic local
   * nearest-door order remains the safe offline fallback.
   */
  const visibleDoors = useMemo(
    () => (activeRoute && routeOptimization ? routeOptimization.ordered : localRouteOrder),
    [activeRoute, localRouteOrder, routeOptimization],
  )

  const counts = useMemo(() => chipCounts(managed, doors.length), [managed, doors.length])

  const pipeline = useMemo(() => {
    const wanted =
      tab === 'follow_up'
        ? (l: ManagedLead) => l.status === 'attempted' || l.status === 'follow_up'
        : tab === 'need_visit'
          ? (l: ManagedLead) => l.status === 'need_visit'
          : (l: ManagedLead) => l.status === 'appointment'
    return managed
      .filter(wanted)
      .sort((a, b) => (a.nextActionAt ?? '').localeCompare(b.nextActionAt ?? ''))
  }, [managed, tab])

  /** Opens a new inspection pre-filled from the door, so the rep types nothing. */
  const startInspection = useCallback(async (lead: ScoredLead): Promise<string> => {
    const at = new Date().toISOString()
    const inspection: LocalInspection = {
      id: newId(),
      createdAt: at,
      updatedAt: at,
      status: 'in_progress',
      addressLine1: lead.address,
      propertyType: 'residential',
      roofMaterial: 'asphalt_shingle',
      syncState: 'local',
      latitude: lead.latitude,
      longitude: lead.longitude,
      ...(lead.city ? { city: lead.city } : {}),
      ...(lead.postalCode ? { postalCode: lead.postalCode } : {}),
    }
    await saveInspection(inspection)
    return inspection.id
  }, [])

  /**
   * The promotion. A door with an outcome recorded against it stops being a
   * row in a regenerated list and becomes a record that survives the refresh.
   */
  const record = useCallback(
    async (door: ScoredLead, outcome: DoorOutcome, options: ApplyOptions) => {
      const at = new Date().toISOString()
      const existing = managedByAddress.get(door.addressKey)
      const base = existing ?? promote(door, at)

      let inspectionId: string | undefined
      if (outcome === 'inspect_now') inspectionId = await startInspection(door)

      // Asked for here rather than inside applyOutcome, which is pure. A four
      // second ceiling, and a failure is recorded as "no fix" rather than
      // holding up the knock.
      const gps = await evidenceFor(door)
      // Which route this happened on, asked now rather than reconstructed later.
      const routeSessionId = await openSessionId()

      const { lead, event } = applyOutcome(base, outcome, at, {
        ...options,
        gps,
        ...(inspectionId !== undefined ? { inspectionId } : {}),
        ...(routeSessionId !== undefined ? { routeSessionId } : {}),
      })
      await saveOutcome(lead, event)
      setManaged(await readLeads())
      setKnocking(null)

      if (inspectionId !== undefined) navigate(`/inspection/${inspectionId}`)
    },
    [managedByAddress, navigate, startInspection],
  )

  const acquireLocation = useCallback(
    async (runAfter = true, overrides: Partial<LeadRunSettings> = {}) => {
      setLocationState('locating')
      const pos = await currentPosition(8000)
      if (!pos) {
        setLocationState('unavailable')
        return null
      }

      const center: SearchCenter = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
        ...(Number.isFinite(pos.coords.accuracy)
          ? { accuracyMeters: Math.round(pos.coords.accuracy) }
          : {}),
      }
      const searchRadiusMiles =
        overrides.searchRadiusMiles ?? settingsRef.current.searchRadiusMiles ?? 5
      const next: LeadRunSettings = {
        ...settingsRef.current,
        ...overrides,
        searchCenter: center,
        searchRadiusMiles,
        bbox: bboxAround(center, searchRadiusMiles),
      }

      setHere({ latitude: center.latitude, longitude: center.longitude })
      setLocationAccuracy(center.accuracyMeters ?? null)
      setLocationState('ready')
      setSettings(next)
      if (runAfter) await refresh(next)
      return next
    },
    [refresh],
  )

  const patch = (p: Partial<LeadRunSettings>) => {
    if (!settings.searchCenter && locationState !== 'ready') {
      void acquireLocation(true, p)
      return
    }

    const searchRadiusMiles = p.searchRadiusMiles ?? settings.searchRadiusMiles ?? 5
    const center = settings.searchCenter
    const next: LeadRunSettings = {
      ...settings,
      ...p,
      searchRadiusMiles,
      ...(center
        ? { bbox: bboxAround(center, searchRadiusMiles) }
        : {}),
    }
    setSettings(next)
    void refresh(next)
  }

  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 text-text-primary p-5 ring-1 ring-border-subtle">
        <p className="font-display text-lg leading-tight tracking-wide">Knock the right doors.</p>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-text-secondary">
          Hail reports crossed with parish permit records: roofs old enough to sell, under a storm,
          with no re-roof permit filed since.
        </p>
        <Button
          variant="gold"
          full
          className="mt-4"
          onClick={() => void acquireLocation(true)}
          disabled={busy || locationState === 'locating'}
        >
          {busy || locationState === 'locating'
            ? 'Finding your location…'
            : run
              ? 'Refresh from my location'
              : 'Use my location & build list'}
        </Button>
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip
          label="New"
          count={counts.newDoors}
          active={tab === 'new'}
          onClick={() => setTab('new')}
        />
        <Chip
          label="Follow-up"
          count={counts.followUp}
          active={tab === 'follow_up'}
          onClick={() => setTab('follow_up')}
        />
        <Chip
          label="Need visit"
          count={counts.needVisit}
          active={tab === 'need_visit'}
          onClick={() => setTab('need_visit')}
        />
        <Chip
          label="Appts"
          count={counts.appointments}
          active={tab === 'appointments'}
          onClick={() => setTab('appointments')}
        />
      </div>

      {error && (
        <Card className="mt-3 bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
          <p className="text-[12.5px] leading-relaxed font-medium text-status-warning">{error}</p>
        </Card>
      )}

      {tab !== 'new' ? (
        <>
          <SectionTitle hint={`${pipeline.length} on this list`}>
            {tab === 'follow_up'
              ? 'OWED ANOTHER VISIT'
              : tab === 'need_visit'
                ? 'WANTS A ROOF LOOKED AT'
                : 'BOOKED'}
          </SectionTitle>
          {pipeline.length === 0 ? (
            <Empty
              title="Nothing here yet"
              body="A door lands here the moment you record what happened at it. Knock one from the New tab and it becomes a lead you can work."
            />
          ) : (
            <div className="space-y-2">
              {pipeline.map((lead) => {
                const scored = run?.leads.find(
                  (candidate) => candidate.addressKey === lead.addressKey,
                )
                return (
                  <PipelineCard
                    key={lead.id}
                    lead={lead}
                    now={now}
                    {...(scored ? { scored } : {})}
                  />
                )
              })}
            </div>
          )}

          <MessagingReadiness leads={managed} />
        </>
      ) : (
        <>
          <SectionTitle hint="These filters search around where you are now.">
            SEARCH AROUND MY LOCATION
          </SectionTitle>
          <Card className="!py-3">
            {locationState === 'ready' && settings.searchCenter ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-semibold text-route-live">
                      ● USING CURRENT LOCATION
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                      Search center updated {relativeTime(settings.searchCenter.capturedAt)}
                      {locationAccuracy !== null ? ` · accuracy ±${locationAccuracy} m` : ''}.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => void acquireLocation(true)} disabled={busy}>
                    Refresh
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-text-primary">
                  Location required for nearby storm leads
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
                  Turn on Location Services so Delta Ridge can search qualifying roofs and hail
                  evidence around where you are standing now. It will not silently use the office
                  or a default Baton Rouge location.
                </p>
                <Button
                  variant="primary"
                  full
                  className="mt-3"
                  onClick={() => void acquireLocation(true)}
                  disabled={locationState === 'locating' || busy}
                >
                  {locationState === 'locating' ? 'Locating…' : 'Enable / Use Location'}
                </Button>
                {locationState === 'unavailable' && (
                  <p className="mt-2 text-[11px] leading-relaxed text-status-warning">
                    Location is unavailable or permission was denied. Enable precise location for
                    this browser/app in device settings, then try again.
                  </p>
                )}
              </>
            )}
          </Card>

          <SectionTitle>FILTERS</SectionTitle>
          <Card className="grid grid-cols-2 gap-3">
            <Field label="Minimum hail">
              <Select
                value={String(settings.minHailInches)}
                onChange={(e) => patch({ minHailInches: Number(e.target.value) })}
              >
                <option value="0.75">0.75" and up</option>
                <option value="1">1" and up</option>
                <option value="1.25">1.25" and up</option>
                <option value="1.75">1.75" and up</option>
              </Select>
            </Field>
            <Field label="Radius">
              <Select
                value={String(settings.searchRadiusMiles ?? 5)}
                onChange={(e) => patch({ searchRadiusMiles: Number(e.target.value) })}
              >
                <option value="1">1 mile</option>
                <option value="2">2 miles</option>
                <option value="3">3 miles</option>
                <option value="5">5 miles</option>
                <option value="10">10 miles</option>
                <option value="15">15 miles</option>
                <option value="25">25 miles</option>
              </Select>
            </Field>
            <Field label="Storm window">
              <Select
                value={settings.windowKey}
                onChange={(e) => patch({ windowKey: e.target.value as StormWindowKey })}
              >
                {SELECTABLE_WINDOWS.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.key === 'this_year' ? `${new Date().getFullYear()} only` : w.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Roof at least">
              <Select
                value={String(settings.builtBefore)}
                onChange={(e) => patch({ builtBefore: Number(e.target.value) })}
              >
                <option value={new Date().getFullYear() - 10}>10 years old</option>
                <option value={new Date().getFullYear() - 12}>12 years old</option>
                <option value={new Date().getFullYear() - 15}>15 years old</option>
                <option value={new Date().getFullYear() - 20}>20 years old</option>
              </Select>
            </Field>
          </Card>

          <Card className="mt-3 !py-2.5">
            <p className="text-[10.5px] uppercase tracking-wider text-text-muted">Current search</p>
            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
              Within {settings.searchRadiusMiles ?? 5} mi · ≥{settings.minHailInches}" hail ·{' '}
              {SELECTABLE_WINDOWS.find((w) => w.key === settings.windowKey)?.label ?? settings.windowKey} · roof ≥
              {Math.max(0, new Date().getFullYear() - settings.builtBefore)} yrs
            </p>
            {!settings.searchCenter && (
              <p className="mt-1 text-[11px] text-status-warning">
                Not active until current location is available.
              </p>
            )}
          </Card>

          {run && (
            <>
              {run.notes.length > 0 && (
                <Card className="mt-3 bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
                  {run.notes.map((note) => (
                    <p key={note} className="text-[12.5px] leading-relaxed text-status-warning/90">
                      {note}
                    </p>
                  ))}
                </Card>
              )}

              {/* Above the storm panel: a rep decides whether to record before
                  they start walking, not after they have worked half a street. */}
              <RoutePanel />

              <CoveragePanel coverage={run.coverage} events={run.stormEvents} />

              {/* Follows the selection. Showing all 150 dots while the rep is
                  working one neighbourhood makes the map answer a question he
                  is not asking. */}
              <LeadMap
                doors={visibleDoors}
                leads={managed}
                storms={run.stormEvents}
                {...(settings.searchCenter ? { searchCenter: settings.searchCenter } : {})}
                searchRadiusMiles={settings.searchRadiusMiles ?? 5}
                onOpenLead={(leadId) => navigate(`/lead/${leadId}`)}
              />

              <SectionTitle hint={busy ? 'updating…' : `built ${relativeTime(run.ranAt)}`}>
                {doors.length > 0 ? `${doors.length} DOORS` : 'NO DOORS'}
              </SectionTitle>

              <ScoreSpread doors={visibleDoors} />

              <Card className="!py-2.5">
                <p className="text-[11.5px] leading-relaxed text-text-secondary">
                  From {run.counts.candidatesConsidered.toLocaleString()} properties and{' '}
                  {run.counts.stormsConsidered} official hail reports in{' '}
                  {run.window.label.toLowerCase()}.{' '}
                  {run.counts.parcelsMatched > 0 && (
                    <>
                      {run.counts.ownerOccupied.toLocaleString()} of{' '}
                      {run.counts.parcelsMatched.toLocaleString()} matched parcels are owner
                      occupied.{' '}
                    </>
                  )}
                  {run.counts.suppressedAlreadyReplaced > 0 && (
                    <span className="text-status-success/80">
                      {run.counts.suppressedAlreadyReplaced} already re-roofed since the storm —
                      dropped.{' '}
                    </span>
                  )}
                  {run.counts.suppressedRoofTooNew > 0 &&
                    `${run.counts.suppressedRoofTooNew} roofs too new. `}
                  {run.counts.suppressedNoHail > 0 &&
                    `${run.counts.suppressedNoHail} outside every swath. `}
                  {suppressed.size > 0 && `${suppressed.size} you asked not to knock again.`}
                </p>
              </Card>

              {/* One filter, not a panel of them. Owner-occupied is the only
                  one that changes who can sign, and a row of toggles on a phone
                  costs more scrolling than it saves. */}
              {/* Shown only when it would actually take something off the
                  list. A toggle that changes nothing is a control a rep learns
                  to ignore, and the score already favours owner-occupied, so
                  on most runs every door here is one. */}
              {doors.some((d) => d.parcel?.occupancy !== 'owner_occupied') && (
                <button
                  onClick={() => {
                    setOwnerOccupiedOnly((v) => !v)
                    setRouteName(null)
                  }}
                  className={`mt-2 w-full rounded-full px-4 py-2 text-[12.5px] ${
                    ownerOccupiedOnly
                      ? 'bg-status-success/20 text-status-success'
                      : 'bg-bg-elevated text-text-secondary'
                  }`}
                >
                  {ownerOccupiedOnly
                    ? `Owner-occupied only · ${filteredDoors.length} of ${doors.length}`
                    : 'Show owner-occupied only'}
                </button>
              )}

              {doors.length === 0 ? (
                <div className="mt-3">
                  <Empty
                    title="Nothing qualifies right now"
                    body="No property matched every filter. Widen the radius, lower the minimum hail size, or extend the storm window — the counts above show which filter is doing the cutting."
                  />
                </div>
              ) : filteredDoors.length === 0 ? (
                <div className="mt-3">
                  <Empty
                    title="No owner-occupied doors on this list"
                    body="Every door here is either a likely rental or an address the parish parcel roll does not carry. Turn the filter off to see them."
                  />
                </div>
              ) : activeRoute ? (
                <div className="mt-2 space-y-2">
                  <RouteHeader
                    route={activeRoute}
                    ordered={visibleDoors}
                    optimization={routeOptimization}
                    optimizing={routeOptimizing}
                    onRetry={() => void optimizeActiveRoute()}
                    onBack={() => {
                      setRouteOptimization(null)
                      setRouteName(null)
                    }}
                  />
                  {visibleDoors.map((lead) => (
                    <DoorCard
                      key={lead.addressKey}
                      lead={lead}
                      managed={managedByAddress.get(lead.addressKey)}
                      onKnock={setKnocking}
                      onPhoneSaved={() => void readLeads().then(setManaged)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {/* Routes first, doors second. A hundred and fifty cards is a
                      scroll, not a plan; a handful of neighbourhoods is a
                      morning. */}
                  {worthADrive.map((route) => (
                    <RouteCard
                      key={route.name}
                      route={route}
                      onPick={() => setRouteName(route.name)}
                    />
                  ))}
                  {singleStops.length > 0 && (
                    <>
                      <SectionTitle hint={`${singleStops.reduce((t, r) => t + r.doors.length, 0)} doors`}>
                        ON THE WAY
                      </SectionTitle>
                      {singleStops.map((route) => (
                        <RouteCard
                          key={route.name}
                          route={route}
                          onPick={() => setRouteName(route.name)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}

              {run.competitors.length > 0 && (
                <>
                  <SectionTitle hint={`${run.counts.reroofPermits} permits`}>
                    WHO ELSE IS WORKING THIS AREA
                  </SectionTitle>
                  <Card>
                    <Button variant="secondary" full onClick={() => setShowCompetitors((v) => !v)}>
                      {showCompetitors ? 'Hide' : 'Show re-roof permits by contractor'}
                    </Button>
                    {showCompetitors && (
                      <ul className="mt-3 space-y-2 border-t border-border-subtle pt-3">
                        {run.competitors.map((c) => (
                          <li
                            key={c.contractorName}
                            className="flex items-baseline justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[13px] text-text-secondary">
                                {c.contractorName}
                              </p>
                              {c.subdivisions.length > 0 && (
                                <p className="truncate text-[11px] text-text-secondary">
                                  {c.subdivisions.join(', ')}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 font-display text-[13px] text-text-secondary">
                              {c.permits}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}

              <p className="mt-6 text-center text-[10.5px] leading-relaxed text-text-secondary">
                NWS Local Storm Reports via Iowa Environmental Mesonet · City of Baton Rouge / East
                Baton Rouge Parish Open Data. East Baton Rouge only — Ascension and Livingston
                publish no permit feed yet.
              </p>
            </>
          )}

          {!run && !busy && (
            <div className="mt-3">
              <Empty
                title="No list yet"
                body="Build one and it is saved on this device, so it still opens with no signal."
              />
            </div>
          )}
        </>
      )}

      {knocking && (
        <DoorOutcomeSheet
          address={knocking.address}
          onCancel={() => setKnocking(null)}
          onRecord={(outcome, options) => void record(knocking, outcome, options)}
        />
      )}
    </div>
  )
}
