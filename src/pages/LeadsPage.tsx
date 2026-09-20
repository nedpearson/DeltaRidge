import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DoorOutcomeSheet from '@/components/DoorOutcomeSheet'
import { Button, Card, Empty, Field, SectionTitle, Select } from '@/components/ui'
import type { StormCoverage } from '@/features/leads/coverage'
import {
  DEFAULT_SETTINGS,
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
  type ManagedLead,
} from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'
import { WINDOW_OPTIONS, type StormWindowKey } from '@/features/leads/window'
import type { StormEvent } from '@/integrations/storm'
import { newId, saveInspection, type LocalInspection } from '@/lib/db'

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
  if (score >= 60) return 'text-emerald-400'
  if (score >= 40) return 'text-gold-400'
  return 'text-white/60'
}

function mapsHref(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}

/** A door nobody has spoken to yet. */
function DoorCard({
  lead,
  managed,
  onKnock,
}: {
  lead: ScoredLead
  managed: ManagedLead | undefined
  onKnock: (lead: ScoredLead) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{lead.address}</p>
          <p className="mt-0.5 truncate text-[12px] text-white/40">
            {[lead.subdivision, lead.city].filter(Boolean).join(' · ') || 'East Baton Rouge Parish'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-display text-2xl leading-none ${tone(lead.score)}`}>{lead.score}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/30">priority</p>
        </div>
      </div>

      {managed && (
        <p className="mt-2 inline-block rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-white/60">
          {STATUS_LABEL[managed.status]} · knocked {managed.knockCount}x
        </p>
      )}

      <ul className="mt-2.5 space-y-1">
        {lead.reasons.map((reason) => (
          <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-white/70">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-400" />
            {reason}
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={mapsHref(lead.latitude, lead.longitude)}
          target="_blank"
          rel="noreferrer"
          className="contents"
        >
          <Button variant="secondary">Navigate</Button>
        </a>
        <Button variant="gold" onClick={() => onKnock(lead)}>
          Knocked it
        </Button>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 w-full !min-h-0 py-1 text-[11px] text-white/35"
      >
        {open ? 'Hide how this ranked' : 'How this ranked'}
      </button>
      {open && (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-[11.5px]">
          <dt className="text-white/35">Hail size</dt>
          <dd className="text-right text-white/70">{lead.components.hailSizeInches}"</dd>
          <dt className="text-white/35">Distance to report</dt>
          <dd className="text-right text-white/70">{lead.components.distanceMiles} mi</dd>
          <dt className="text-white/35">Days since storm</dt>
          <dd className="text-right text-white/70">{lead.components.daysSinceStorm}</dd>
          <dt className="text-white/35">Roof age</dt>
          <dd className="text-right text-white/70">{lead.components.roofAgeYears} yrs</dd>
          <dd className="col-span-2 mt-1 text-[10.5px] leading-relaxed text-white/25">
            Priority is a weighted sum of these four, with hand-set weights. It ranks
            documentation-worthy opportunity, not the chance of a sale — there is no closed-won
            history in this system yet to learn one from.
          </dd>
        </dl>
      )}
    </Card>
  )
}

/** A door that has become somebody. */
function PipelineCard({ lead, now }: { lead: ManagedLead; now: string }) {
  const navigate = useNavigate()
  const due = dueLabel(lead, now)
  const overdue = isDue(lead, now)

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{lead.contactName ?? lead.address}</p>
          <p className="mt-0.5 truncate text-[12px] text-white/40">
            {lead.contactName
              ? lead.address
              : [lead.subdivision, lead.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        {due && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
              overdue ? 'bg-gold-500/20 text-gold-300' : 'bg-white/8 text-white/55'
            }`}
          >
            {due}
          </span>
        )}
      </div>

      <p className="mt-2 text-[12px] text-white/45">
        {STATUS_LABEL[lead.status]} · knocked {lead.knockCount}x · added {relativeDay(lead.createdAt)}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
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
          <p className="text-[13px] text-white/80">Official ground reports</p>
          {official.kind === 'live' ? (
            <p className="shrink-0 font-display text-[15px] text-emerald-400">{official.count}</p>
          ) : (
            <p className="shrink-0 text-[11px] uppercase tracking-wider text-amber-300">
              {official.kind === 'failed' ? 'unavailable' : 'off'}
            </p>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
          NWS Local Storm Reports — someone on the ground reported hail and the NWS logged it.
          {official.kind === 'live' && official.newestAt
            ? ` Most recent: ${shortDate(official.newestAt)}.`
            : ''}
          {official.kind === 'failed' ? ` ${official.why}` : ''}
        </p>

        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-white/8 pt-3">
          <p className="text-[13px] text-white/80">Radar-estimated hail (MRMS/MESH)</p>
          <p className="shrink-0 text-[11px] uppercase tracking-wider text-amber-300">
            not configured
          </p>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
          {coverage.radar.kind === 'not_configured'
            ? coverage.radar.why
            : 'Radar-estimated hail is running.'}
        </p>

        {coverage.byYear.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
            {coverage.byYear.map((y) => (
              <span
                key={y.year}
                className="rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-white/60"
              >
                {y.year} · {y.count}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 w-full !min-h-0 py-1 text-[11px] text-white/35"
        >
          {open ? 'Hide storms' : `View ${events.length} storm${events.length === 1 ? '' : 's'}`}
        </button>
        {open && (
          <ul className="mt-1 space-y-1.5 border-t border-white/8 pt-2">
            {events.length === 0 && (
              <li className="text-[11.5px] leading-relaxed text-white/40">
                Nothing qualified in this window. That is the feed answering, not the feed failing.
              </li>
            )}
            {[...events]
              .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
              .map((e) => (
                <li key={e.externalId} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] text-white/75">
                      {[e.city, e.countyParish].filter(Boolean).join(', ') || 'Unnamed location'}
                    </p>
                    <p className="text-[10.5px] text-white/30">
                      {shortDate(e.occurredAt)} · official report
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
        active ? 'bg-gold-500 text-brand-950' : 'bg-white/8 text-white/55'
      }`}
    >
      {label}
      <span className={`font-display text-[13px] ${active ? 'text-brand-950' : 'text-white/80'}`}>
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

  useEffect(() => {
    void readCachedRun().then((cached) => {
      if (cached) {
        setRun(cached)
        setSettings(cached.settings)
      }
    })
    void readLeads().then(setManaged)
  }, [])

  const refresh = useCallback(async (next: LeadRunSettings) => {
    setBusy(true)
    setError(null)
    try {
      setRun(await runLeadEngine(next))
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not build the list: ${err.message}. Anything already downloaded is still below.`
          : 'Could not build the list. Anything already downloaded is still below.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

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

      const { lead, event } = applyOutcome(base, outcome, at, {
        ...options,
        ...(inspectionId !== undefined ? { inspectionId } : {}),
      })
      await saveOutcome(lead, event)
      setManaged(await readLeads())
      setKnocking(null)

      if (inspectionId !== undefined) navigate(`/inspection/${inspectionId}`)
    },
    [managedByAddress, navigate, startInspection],
  )

  const patch = (p: Partial<LeadRunSettings>) => {
    const next = { ...settings, ...p }
    setSettings(next)
    void refresh(next)
  }

  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 ring-1 ring-white/10">
        <p className="font-display text-lg leading-tight tracking-wide">Knock the right doors.</p>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-white/60">
          Hail reports crossed with parish permit records: roofs old enough to sell, under a storm,
          with no re-roof permit filed since.
        </p>
        <Button
          variant="gold"
          full
          className="mt-4"
          onClick={() => void refresh(settings)}
          disabled={busy}
        >
          {busy ? 'Building the list…' : run ? 'Refresh the list' : 'Build the list'}
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
        <Card className="mt-3 !bg-amber-500/8 ring-amber-500/20">
          <p className="text-[12.5px] leading-relaxed text-amber-200/90">{error}</p>
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
              {pipeline.map((lead) => (
                <PipelineCard key={lead.id} lead={lead} now={now} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
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
                value={String(settings.radiusMiles)}
                onChange={(e) => patch({ radiusMiles: Number(e.target.value) })}
              >
                <option value="1">1 mile</option>
                <option value="2">2 miles</option>
                <option value="3">3 miles</option>
                <option value="5">5 miles</option>
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

          {run && (
            <>
              {run.notes.length > 0 && (
                <Card className="mt-3 !bg-amber-500/8 ring-amber-500/20">
                  {run.notes.map((note) => (
                    <p key={note} className="text-[12.5px] leading-relaxed text-amber-200/90">
                      {note}
                    </p>
                  ))}
                </Card>
              )}

              <CoveragePanel coverage={run.coverage} events={run.stormEvents} />

              <SectionTitle hint={`built ${relativeDay(run.ranAt)}`}>
                {doors.length > 0 ? `${doors.length} DOORS` : 'NO DOORS'}
              </SectionTitle>

              <Card className="!py-2.5">
                <p className="text-[11.5px] leading-relaxed text-white/45">
                  From {run.counts.candidatesConsidered.toLocaleString()} properties and{' '}
                  {run.counts.stormsConsidered} official hail reports in{' '}
                  {run.window.label.toLowerCase()}.{' '}
                  {run.counts.suppressedAlreadyReplaced > 0 && (
                    <span className="text-emerald-300/80">
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

              {doors.length === 0 ? (
                <div className="mt-3">
                  <Empty
                    title="Nothing qualifies right now"
                    body="No property matched every filter. Widen the radius, lower the minimum hail size, or extend the storm window — the counts above show which filter is doing the cutting."
                  />
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {doors.map((lead) => (
                    <DoorCard
                      key={lead.addressKey}
                      lead={lead}
                      managed={managedByAddress.get(lead.addressKey)}
                      onKnock={setKnocking}
                    />
                  ))}
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
                      <ul className="mt-3 space-y-2 border-t border-white/8 pt-3">
                        {run.competitors.map((c) => (
                          <li
                            key={c.contractorName}
                            className="flex items-baseline justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-[13px] text-white/80">
                                {c.contractorName}
                              </p>
                              {c.subdivisions.length > 0 && (
                                <p className="truncate text-[11px] text-white/35">
                                  {c.subdivisions.join(', ')}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 font-display text-[13px] text-white/60">
                              {c.permits}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}

              <p className="mt-6 text-center text-[10.5px] leading-relaxed text-white/25">
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
