import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import { readCachedRun } from '@/features/leads/engine'
import type { ScoredLead } from '@/features/leads/scoring'
import { assignDoorTo } from '@/features/manager/assign'
import {
  EMPTY_SNAPSHOT,
  assignedLeads,
  outcomesFrom,
  readFollowups,
  readManagerSnapshot,
  unassignLead,
  type FollowupRow,
  type ManagerSnapshot,
} from '@/features/manager/read'
import RoutesTab from '@/features/manager/tabs/RoutesTab'
import CampaignsTab from '@/features/manager/tabs/CampaignsTab'
import {
  fieldToday,
  locationNote,
  REP_STATUS_LABEL,
} from '@/features/manager/field-today'
import { resolveHistoryWindow } from '@/features/routes/history'
import {
  coverageGaps,
  coverageTotals,
  readCoverage,
  PASSED_RADIUS_METERS,
  type CoverageRow,
} from '@/features/manager/coverage'
import { dailyRollup, exceptions } from '@/features/manager/daily'
import { factsFor, writeBrief } from '@/features/manager/brief'
import PerformanceTab from '@/features/manager/tabs/PerformanceTab'
import GradesTab from '@/features/manager/tabs/GradesTab'
import SettingsTab from '@/features/manager/tabs/SettingsTab'
import RoofrTab from '@/features/integrations/roofr/RoofrTab'
import ContactProviderTab from '@/features/contacts/ContactProviderTab'
import HealthTab from '@/features/integrations/health/HealthTab'
import { readGradingConfig } from '@/features/manager/grade-store'
import { DEFAULT_CONFIG, type GradingConfig } from '@/features/manager/grading'
import { DEFAULT_WINDOW_DAYS } from '@/features/manager/read'
import {
  efficiencyFor,
  orgBaseline,
  rollUpActivity,
  suggestAssignees,
  territoryCoverage,
  COMFORTABLE_OPEN_ASSIGNMENTS,
  type ActivityRow,
  type RepContext,
  type RouteRow,
} from '@/features/manager/metrics'

/**
 * What a manager sees, and the reasoning behind every number on it.
 *
 * Three commitments run through this screen.
 *
 * Nothing here decides anything. It ranks, it explains, and a person acts. No
 * figure on this page is an instruction, and the copy says so where somebody
 * might reasonably assume otherwise.
 *
 * Nothing here is a black box. Every score shows its parts. A rep should be able
 * to read the same breakdown their manager did and argue with it.
 *
 * Empty is drawn as empty. A team with no data and a server that could not be
 * reached look identical if you collapse them into a zero, and one of those is a
 * rep who did no work while the other is a bug. They are separate states here.
 */

type Tab =
  | 'team'
  | 'field'
  | 'routes'
  | 'campaigns'
  | 'performance'
  | 'grades'
  | 'leads'
  | 'territory'
  | 'log'
  | 'settings'
  | 'roofr'
  | 'contacts'
  | 'health'

const TABS: { id: Tab; label: string }[] = [
  { id: 'team', label: 'Team' },
  { id: 'field', label: 'Live field' },
  { id: 'routes', label: 'Routes' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'performance', label: 'Performance' },
  { id: 'grades', label: 'Grades' },
  { id: 'leads', label: 'Assign' },
  { id: 'territory', label: 'Territory' },
  { id: 'log', label: 'Log' },
  { id: 'settings', label: 'Settings' },
  { id: 'roofr', label: 'Roofr' },
  { id: 'contacts', label: 'Contact data' },
  { id: 'health', label: 'Health' },
]

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return 'never'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.floor(hours / 24)} days ago`
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[19px] font-semibold leading-tight">{value}</p>
      <p className="text-[10.5px] uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}

/** The one thing every tab needs and none of them should invent. */
function Nothing({ title, body }: { title: string; body: string }) {
  return <Empty title={title} body={body} />
}

export default function ManagerPage() {
  const { session, membership } = useSession()
  const [tab, setTab] = useState<Tab>('team')
  const [snapshot, setSnapshot] = useState<ManagerSnapshot>(EMPTY_SNAPSHOT)
  const [doors, setDoors] = useState<ScoredLead[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [followups, setFollowups] = useState<FollowupRow[]>([])
  const [config, setConfig] = useState<GradingConfig>(DEFAULT_CONFIG)
  const [configIsDefault, setConfigIsDefault] = useState(true)

  const orgId = membership?.organizationId ?? null
  const canManage = membership?.role === 'admin' || membership?.role === 'manager'

  const load = useCallback(async () => {
    setLoading(true)
    const [snap, run, follow, grading] = await Promise.all([
      readManagerSnapshot(orgId),
      readCachedRun(),
      readFollowups(orgId),
      readGradingConfig(orgId),
    ])
    setSnapshot(snap)
    setDoors(run?.leads ?? [])
    setFollowups(follow.rows)
    setConfig(grading.config)
    setConfigIsDefault(grading.isDefault)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of snapshot.team) map.set(m.userId, m.fullName ?? 'Unnamed rep')
    return map
  }, [snapshot.team])

  const nameOf = useCallback(
    (id: string | null) => (id ? (names.get(id) ?? 'Someone no longer on the team') : 'Unattributed'),
    [names],
  )

  const outcomes = useMemo(() => outcomesFrom(snapshot.assignments), [snapshot.assignments])
  const leadsWithFollowups = useMemo(
    () => assignedLeads(snapshot.assignments, followups),
    [snapshot.assignments, followups],
  )
  // The window the server was asked for. Every per-rep figure is computed
  // inside it, so the screen and the query cannot drift apart.
  const windowFrom = useMemo(
    () => new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString(),
    [],
  )
  const windowTo = useMemo(() => new Date().toISOString(), [])
  const baseline = useMemo(() => orgBaseline(outcomes), [outcomes])
  const repActivity = useMemo(() => rollUpActivity(snapshot.activity), [snapshot.activity])
  const coverage = useMemo(
    () => territoryCoverage(doors, snapshot.activity),
    [doors, snapshot.activity],
  )

  /**
   * Coverage is computed on the server and returns aggregates only.
   *
   * Loaded separately from the snapshot because it is the one read that needs
   * a spatial join over every fix in the window, and it must not be able to
   * delay or fail the rest of the screen.
   */
  const [routeCoverage, setRouteCoverage] = useState<CoverageRow[]>([])
  const [routeCoverageError, setRouteCoverageError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void readCoverage(orgId, windowFrom, windowTo).then((result) => {
      if (cancelled) return
      setRouteCoverage(result.rows)
      setRouteCoverageError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [orgId, windowFrom, windowTo])

  const openByRep = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of snapshot.assignments) {
      if (a.unassignedAt) continue
      map.set(a.assignedTo, (map.get(a.assignedTo) ?? 0) + 1)
    }
    return map
  }, [snapshot.assignments])

  const repContexts = useMemo<RepContext[]>(() => {
    const worked = new Map<string, Set<string>>()
    for (const row of snapshot.activity) {
      if (!row.userId || !row.subdivision) continue
      const set = worked.get(row.userId) ?? new Set<string>()
      set.add(row.subdivision)
      worked.set(row.userId, set)
    }
    return snapshot.team
      .filter((m) => m.isActive && m.role !== 'office')
      .map((m) => ({
        repId: m.userId,
        openAssignments: openByRep.get(m.userId) ?? 0,
        workedSubdivisions: worked.get(m.userId) ?? new Set<string>(),
        efficiency: efficiencyFor(m.userId, outcomes, baseline).index,
      }))
  }, [snapshot.team, snapshot.activity, openByRep, outcomes, baseline])

  if (!session) {
    return <Nothing title="Sign in" body="These screens read from the server, so they need an account." />
  }

  return (
    <div className="space-y-4">
      <SectionTitle {...(loading ? { hint: 'loading…' } : {})}>MANAGER</SectionTitle>

      {snapshot.error && (
        <Card className="!bg-amber-500/8 ring-amber-500/20">
          <p className="text-[13.5px] font-semibold text-amber-200">These numbers could not be loaded.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-100/70">{snapshot.error}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-100/50">
            Nothing below is showing zero because the team did nothing — it is showing nothing because the
            read failed.
          </p>
          <Button variant="secondary" full className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      )}

      {!canManage && (
        <Card>
          <p className="text-[12px] leading-relaxed text-white/45">
            You are signed in as a {membership?.role ?? 'member'}, so the server returns your own rows only.
            That is enforced where the data lives, not by hiding anything here.
          </p>
        </Card>
      )}

      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              tab === t.id ? 'bg-gold-400 text-black' : 'bg-white/6 text-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && (
        <TeamTab
          repActivity={repActivity}
          outcomes={outcomes}
          baseline={baseline}
          nameOf={nameOf}
          openByRep={openByRep}
          loading={loading}
        />
      )}

      {tab === 'field' && (
        <FieldTab
          repIds={snapshot.team.map((m) => m.userId)}
          routes={snapshot.routes}
          activity={snapshot.activity}
          nameOf={nameOf}
          loading={loading}
        />
      )}

      {tab === 'routes' && (
        <RoutesTab
          routes={snapshot.routes}
          activity={snapshot.activity}
          orgId={orgId}
          nameOf={nameOf}
          loading={loading}
        />
      )}

      {tab === 'campaigns' && <CampaignsTab />}

      {tab === 'performance' && (
        <PerformanceTab
          team={snapshot.team}
          activity={snapshot.activity}
          routes={snapshot.routes}
          assignments={leadsWithFollowups}
          baseline={baseline}
          nameOf={nameOf}
          windowFrom={windowFrom}
          windowTo={windowTo}
        />
      )}

      {tab === 'grades' && (
        <GradesTab
          team={snapshot.team}
          activity={snapshot.activity}
          routes={snapshot.routes}
          assignments={leadsWithFollowups}
          baseline={baseline}
          config={config}
          orgId={orgId}
          userId={session.user.id}
          canManage={canManage}
          nameOf={nameOf}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          config={config}
          isDefault={configIsDefault}
          orgId={orgId}
          userId={session.user.id}
          canManage={canManage}
          onSaved={() => void load()}
        />
      )}

      {tab === 'roofr' && <RoofrTab organizationId={orgId} canManage={canManage} />}

      {tab === 'health' && <HealthTab organizationId={orgId} />}

      {tab === 'contacts' && (
        <ContactProviderTab
          organizationId={orgId}
          userId={session.user.id}
          canManage={membership?.role === 'admin'}
        />
      )}

      {tab === 'leads' && (
        <AssignTab
          doors={doors}
          assignments={snapshot.assignments}
          reps={repContexts}
          nameOf={nameOf}
          canManage={canManage}
          busy={busy}
          onUnassign={async (id) => {
            setBusy(id)
            await unassignLead(id)
            setBusy(null)
            await load()
          }}
          onAssign={async (door, repId, reason) => {
            if (!orgId || !session) return 'Not signed in to an organization.'
            setBusy(`${door.addressKey}:${repId}`)
            const result = await assignDoorTo({
              door,
              orgId,
              assignTo: repId,
              assignedBy: session.user.id,
              reason,
            })
            setBusy(null)
            if (result.ok) await load()
            return result.error
          }}
        />
      )}

      {tab === 'territory' && (
        <TerritoryTab
          coverage={coverage}
          hasDoors={doors.length > 0}
          routeCoverage={routeCoverage}
          routeCoverageError={routeCoverageError}
        />
      )}

      {tab === 'log' && <LogTab rows={snapshot.audit} nameOf={nameOf} loading={loading} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function TeamTab({
  repActivity,
  outcomes,
  baseline,
  nameOf,
  openByRep,
  loading,
}: {
  repActivity: ReturnType<typeof rollUpActivity>
  outcomes: ReturnType<typeof outcomesFrom>
  baseline: ReturnType<typeof orgBaseline>
  nameOf: (id: string | null) => string
  openByRep: Map<string, number>
  loading: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (loading) return <Card><p className="text-[13px] text-white/45">Reading the server…</p></Card>
  if (repActivity.length === 0) {
    return (
      <Nothing
        title="No recorded work yet"
        body="Nobody has knocked a door that reached the server in this window. This is an empty record, not a measured zero."
      />
    )
  }

  return (
    <div className="space-y-2">
      {repActivity.map((rep) => {
        const eff = efficiencyFor(rep.repId, outcomes, baseline)
        const expanded = open === rep.repId
        return (
          <Card key={rep.repId}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[14px] font-semibold">{nameOf(rep.repId)}</p>
              <span className="shrink-0 text-[11.5px] text-white/35">
                {openByRep.get(rep.repId) ?? 0} open
              </span>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              <Stat value={String(rep.knocks)} label="knocks" />
              <Stat value={String(rep.doors)} label="doors" />
              <Stat value={String(rep.conversations)} label="spoke" />
              <Stat value={String(rep.appointments)} label="appts" />
            </div>

            <div className="mt-3 border-t border-white/8 pt-3">
              <p className="text-[11px] uppercase tracking-wide text-white/35">GPS evidence</p>
              <p className="mt-1 text-[12.5px] text-white/70">
                {rep.verified} confirmed · {rep.probable} consistent · {rep.unverified} off-property ·{' '}
                {rep.noFix} no fix
              </p>
              {rep.offPropertyShare === null ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-white/35">
                  Too few usable fixes to draw any conclusion from.
                </p>
              ) : (
                <p className="mt-1 text-[11.5px] leading-relaxed text-white/35">
                  {pct(rep.offPropertyShare)} of knocks with a usable fix were away from the property.
                  Phones and parcel maps are both wrong sometimes.
                </p>
              )}
            </div>

            <div className="mt-3 border-t border-white/8 pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[11px] uppercase tracking-wide text-white/35">Against the doors given</p>
                <p className="text-[15px] font-semibold">
                  {eff.index === null ? '—' : eff.index.toFixed(2)}
                </p>
              </div>
              {eff.unavailable ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">{eff.unavailable}</p>
              ) : (
                <p className="mt-1 text-[11.5px] leading-relaxed text-white/40">
                  {eff.won} closed against {eff.expected?.toFixed(1)} the team&apos;s own rate predicts for
                  doors of the same score. 1.00 is exactly par. This is decision support, not a rating.
                </p>
              )}
              {eff.contributions.length > 0 && (
                <>
                  <button
                    onClick={() => setOpen(expanded ? null : rep.repId)}
                    className="mt-2 text-[11.5px] text-white/45 underline"
                  >
                    {expanded ? 'Hide the arithmetic' : 'Show the arithmetic'}
                  </button>
                  {expanded && (
                    <ul className="mt-2 space-y-1.5">
                      {eff.contributions.map((c) => (
                        <li key={c.label} className="text-[11.5px] leading-relaxed text-white/50">
                          <span className="font-semibold text-white/70">Score {c.label}</span> ·{' '}
                          {c.decided} decided ·{' '}
                          {c.teamRate === null
                            ? 'team has no rate here yet, so this band is left out of both sides'
                            : `team converts ${pct(c.teamRate)} → ${c.expected?.toFixed(1)} expected, ${c.actual} actual`}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function FieldTab({
  repIds,
  routes,
  activity,
  nameOf,
  loading,
}: {
  repIds: readonly string[]
  routes: readonly RouteRow[]
  activity: readonly ActivityRow[]
  nameOf: (id: string | null) => string
  loading: boolean
}) {
  // One definition of "today", shared with the rep's own history screen, and
  // resolved against the local clock: a rep knocking at 7pm in Baton Rouge is
  // already on tomorrow's date in UTC.
  const today = useMemo(() => resolveHistoryWindow('today'), [])
  const rows = useMemo(
    () =>
      fieldToday({
        repIds,
        routes: routes.filter((r) => r.startedAt >= today.from && r.startedAt <= today.to),
        activity: activity.filter((a) => a.occurredAt >= today.from && a.occurredAt <= today.to),
      }),
    [repIds, routes, activity, today],
  )

  // The day so far, computed before anything is said about it. The brief is a
  // rephrasing of these figures and never a source of one - see brief.ts.
  const rollup = dailyRollup({ from: today.from, to: today.to, routes, activity })
  const flagged = exceptions({ from: today.from, to: today.to, routes, activity })
  const brief = writeBrief(factsFor(rollup, flagged))

  if (loading) return <Card><p className="text-[13px] text-white/45">Reading the server…</p></Card>

  const out = rows.filter((r) => r.status === 'active' || r.status === 'paused')

  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[12px] leading-relaxed text-white/45">
          Only routes a rep has started and not yet stopped are followed here. Nobody&apos;s location is
          recorded or shown outside one, including their own, and a declared break stops the
          recording entirely.
        </p>
      </Card>

      <Card>
        <p className="text-[11px] uppercase tracking-wider text-white/35">Today so far</p>
        {brief.map((line, i) => (
          <p key={i} className="mt-1 text-[12.5px] leading-relaxed text-white/70">
            {line}
          </p>
        ))}
      </Card>

      {flagged.length > 0 && (
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-amber-200/60">
            Worth a look · {flagged.length}
          </p>
          {/*
            Facts about records, never conclusions about people. The wording is
            the feature: each line says what to go and check, and none of them
            asserts why it happened.
          */}
          <ul className="mt-2 space-y-1.5">
            {flagged.map((e, i) => (
              <li key={`${e.kind}-${i}`} className="text-[12px] leading-relaxed text-white/65">
                {e.repId && <span className="text-white/85">{nameOf(e.repId)}: </span>}
                {e.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {out.length === 0 && (
        <Nothing title="Nobody is on a route" body="This is what an ordinary evening looks like." />
      )}

      {rows.map((row) => (
        <Card key={row.repId}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[14px] font-semibold">{nameOf(row.repId)}</p>
            <span
              className={
                'shrink-0 text-[11px] uppercase tracking-wider ' +
                (row.status === 'active'
                  ? 'text-emerald-300'
                  : row.status === 'paused'
                    ? 'text-purple-300'
                    : 'text-white/35')
              }
            >
              {REP_STATUS_LABEL[row.status]}
            </span>
          </div>

          {row.startedAt && (
            <p className="mt-0.5 text-[11.5px] text-white/40">
              started {ago(row.startedAt)}
              {row.lastFixAt ? ` · last fix ${ago(row.lastFixAt)}` : ' · no fix yet'}
            </p>
          )}

          <div className="mt-3 grid grid-cols-4 gap-2">
            <Stat value={String(row.doors.doors)} label="doors" />
            <Stat value={String(row.doors.conversations)} label="spoke to" />
            <Stat value={String(row.doors.appointments)} label="booked" />
            <Stat value={String(row.inspections)} label="inspected" />
          </div>

          {/*
            Status and location are two different facts and stay two different
            lines. A rep working a dead-signal subdivision is genuinely active
            with a forty minute old fix; drawing that as a dot would be a claim
            about where somebody is that the data does not support. `mappable`
            is the only thing allowed to put a pin on a map.
          */}
          <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
            {locationNote(row)}
            {row.status === 'active' && row.freshness === 'stale' && (
              <>
                {' '}
                That is not evidence they stopped working: buildings, pockets and dead batteries all
                look like this.
              </>
            )}
          </p>
        </Card>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function AssignTab({
  doors,
  assignments,
  reps,
  nameOf,
  canManage,
  busy,
  onUnassign,
  onAssign,
}: {
  doors: ScoredLead[]
  assignments: ManagerSnapshot['assignments']
  reps: RepContext[]
  nameOf: (id: string | null) => string
  canManage: boolean
  busy: string | null
  onUnassign: (id: string) => Promise<void>
  onAssign: (door: ScoredLead, repId: string, reason: string) => Promise<string | null>
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const openAssignments = assignments.filter((a) => !a.unassignedAt)

  const candidates = useMemo(() => {
    const taken = new Set(openAssignments.map((a) => a.leadClientId))
    return doors.filter((d) => !taken.has(d.addressKey)).slice(0, 25)
  }, [doors, openAssignments])

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[12px] leading-relaxed text-white/45">
          Suggestions rank reps and show every term that went into the ranking. Nothing is assigned
          automatically, and a rep with no index yet is neither rewarded nor penalised for it.
        </p>
      </Card>

      <SectionTitle>CURRENTLY ASSIGNED</SectionTitle>
      {openAssignments.length === 0 ? (
        <Nothing title="Nothing assigned" body="No door on the server has a rep against it yet." />
      ) : (
        <div className="space-y-2">
          {openAssignments.map((a) => (
            <Card key={a.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13.5px] font-semibold">{a.address}</p>
                <span className="shrink-0 text-[12px] text-white/40">{a.scoreAtAssignment}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-white/45">
                {nameOf(a.assignedTo)} · {ago(a.assignedAt)} · {a.leadStatus.replace(/_/g, ' ')}
              </p>
              {a.reason && <p className="mt-1 text-[11.5px] text-white/35">{a.reason}</p>}
              {canManage && (
                <Button
                  variant="secondary"
                  full
                  className="mt-3"
                  disabled={busy === a.id}
                  onClick={() => void onUnassign(a.id)}
                >
                  {busy === a.id ? 'Releasing…' : 'Release this door'}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <SectionTitle hint={`${candidates.length} shown`}>UNASSIGNED DOORS</SectionTitle>
      {candidates.length === 0 ? (
        <Nothing
          title="No doors to hand out"
          body="Either the door list has not been built on this device, or everything on it is already assigned."
        />
      ) : (
        <div className="space-y-2">
          {candidates.map((door) => {
            const expanded = picked === door.addressKey
            const suggestions = expanded
              ? suggestAssignees(
                  { score: door.score, ...(door.subdivision ? { subdivision: door.subdivision } : {}) },
                  reps,
                )
              : []
            return (
              <Card key={door.addressKey}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13.5px] font-semibold">{door.address}</p>
                  <span className="shrink-0 text-[12px] text-white/40">{door.score}</span>
                </div>
                {door.subdivision && (
                  <p className="mt-0.5 text-[12px] text-white/45">{door.subdivision}</p>
                )}
                <button
                  onClick={() => setPicked(expanded ? null : door.addressKey)}
                  className="mt-2 text-[11.5px] text-white/45 underline"
                >
                  {expanded ? 'Hide suggestions' : 'Who should take this?'}
                </button>

                {expanded && (
                  <div className="mt-2 space-y-2 border-t border-white/8 pt-2">
                    {suggestions.length === 0 ? (
                      <p className="text-[11.5px] text-white/40">
                        No active reps on the team to suggest.
                      </p>
                    ) : (
                      suggestions.map((s) => (
                        <div key={s.repId}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-[12.5px] font-semibold">{nameOf(s.repId)}</p>
                            <span className="text-[12px] text-white/40">{s.score}</span>
                          </div>
                          <ul className="mt-0.5 space-y-0.5">
                            {s.factors.map((f) => (
                              <li key={f.label} className="text-[11.5px] leading-relaxed text-white/45">
                                <span className={f.weight < 0 ? 'text-amber-200/70' : 'text-white/60'}>
                                  {f.weight > 0 ? '+' : ''}
                                  {f.weight}
                                </span>{' '}
                                {f.label} — {f.detail}
                              </li>
                            ))}
                          </ul>
                          {canManage && (
                            <Button
                              variant="secondary"
                              full
                              className="mt-2"
                              disabled={busy === `${door.addressKey}:${s.repId}`}
                              onClick={() => {
                                setFailed(null)
                                void onAssign(
                                  door,
                                  s.repId,
                                  // The reason is recorded with the assignment
                                  // and shown in the audit log, so the decision
                                  // carries its own justification.
                                  s.factors
                                    .filter((f) => f.weight !== 0)
                                    .map((f) => f.label)
                                    .join(' · '),
                                ).then((err) => setFailed(err))
                              }}
                            >
                              {busy === `${door.addressKey}:${s.repId}`
                                ? 'Sending and assigning…'
                                : `Give it to ${nameOf(s.repId).split(' ')[0]}`}
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                    {failed && (
                      <p className="text-[11.5px] leading-relaxed text-amber-200/80">{failed}</p>
                    )}
                    <p className="text-[11px] leading-relaxed text-white/30">
                      Assigning sends this door to the server first, as a target rather than a knock.
                      Nothing about it implies anyone has been there.
                    </p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-white/30">
        A rep carrying more than {COMFORTABLE_OPEN_ASSIGNMENTS} open doors is marked as stretched rather
        than simply ranked lower without explanation.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function TerritoryTab({
  coverage,
  hasDoors,
  routeCoverage,
  routeCoverageError,
}: {
  coverage: ReturnType<typeof territoryCoverage>
  hasDoors: boolean
  routeCoverage: readonly CoverageRow[]
  routeCoverageError: string | null
}) {
  const gaps = coverageGaps(routeCoverage)
  const totals = coverageTotals(routeCoverage)

  const whereTheTeamWent =
    routeCoverage.length > 0 || routeCoverageError ? (
      <>
        <SectionTitle>WHERE THE TEAM ACTUALLY WENT</SectionTitle>
        <Card className="mb-2">
          {/*
            The distinction the whole block exists for. Passing a house is not
            knocking it, and the gap between the two is the only number here
            that tells anybody what to do tomorrow.
          */}
          <p className="text-[12px] leading-relaxed text-white/45">
            <b className="text-white/70">Passed</b> means the recorded trail came within{' '}
            {PASSED_RADIUS_METERS} m of the house. It is not a visit and nobody is credited for it.{' '}
            <b className="text-white/70">Knocked</b> means an outcome was recorded there. The gap
            between them is work on a street the team has already paid to reach.
          </p>
          {routeCoverageError && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/70">
              Coverage could not be read: {routeCoverageError}. The figures below are missing, not
              zero.
            </p>
          )}
          {routeCoverage.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat value={String(totals.passed)} label="doors passed" />
              <Stat value={String(totals.knocked)} label="doors knocked" />
              <Stat
                value={totals.workRate === null ? '—' : pct(totals.workRate)}
                label="of what they reached"
              />
            </div>
          )}
        </Card>

        {gaps.map((gap) => (
          <Card key={`gap-${gap.subdivision}`} className="mb-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[13.5px] font-semibold">{gap.subdivision}</p>
              <span className="shrink-0 text-[12px] text-white/40">
                {gap.workRate === null ? '—' : pct(gap.workRate)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-white/45">
              {gap.passedNotKnocked > 0
                ? `${gap.passedNotKnocked} door${gap.passedNotKnocked === 1 ? '' : 's'} gone past and not knocked`
                : 'Every door the trail reached was knocked'}
              {gap.untouched > 0 && ` · ${gap.untouched} never reached`}
            </p>
          </Card>
        ))}
      </>
    ) : null

  if (coverage.length === 0) {
    return (
      <div className="space-y-2">
        {whereTheTeamWent}
        <Nothing
          title="Nothing to measure yet"
          body="Coverage compares the door list built on this device against knocks on the server. Neither has anything in it."
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {whereTheTeamWent}
      <SectionTitle>AGAINST THIS DEVICE&apos;S DOOR LIST</SectionTitle>
      <TerritoryFromDevice coverage={coverage} hasDoors={hasDoors} />
    </div>
  )
}

function TerritoryFromDevice({
  coverage,
  hasDoors,
}: {
  coverage: ReturnType<typeof territoryCoverage>
  hasDoors: boolean
}) {
  if (coverage.length === 0) {
    return (
      <Nothing
        title="Nothing to measure yet"
        body="Coverage compares the door list built on this device against knocks on the server. Neither has anything in it."
      />
    )
  }

  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[12px] leading-relaxed text-white/45">
          Available doors come from the list built on this device; knocks come from the server. A
          neighbourhood this phone has never loaded shows nothing available — never as fully covered.
          {!hasDoors && ' No door list is loaded here right now, so every denominator below is unknown.'}
        </p>
      </Card>

      {coverage.map((row) => (
        <Card key={row.subdivision}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[13.5px] font-semibold">{row.subdivision}</p>
            <span className="shrink-0 text-[12px] text-white/40">
              {row.available > 0 ? pct(row.share) : '—'}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-white/45">
            {row.knocked} knocked
            {row.available > 0
              ? ` of ${row.available} on the list`
              : ' · not on this device’s list, so the total is unknown'}
            {row.bestScore !== null && ` · best door ${row.bestScore}`}
          </p>
          {row.available > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-gold-400"
                style={{ width: `${Math.round(row.share * 100)}%` }}
              />
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function LogTab({
  rows,
  nameOf,
  loading,
}: {
  rows: ManagerSnapshot['audit']
  nameOf: (id: string | null) => string
  loading: boolean
}) {
  if (loading) return <Card><p className="text-[13px] text-white/45">Reading the server…</p></Card>
  if (rows.length === 0) {
    return (
      <Nothing
        title="No assignment decisions yet"
        body="Every hand-over and release is recorded here permanently, by the database itself rather than by the app."
      />
    )
  }

  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[12px] leading-relaxed text-white/45">
          Written by the database on every assignment change, and not editable by anyone — including an
          admin. The score shown is the one frozen at the moment the decision was made.
        </p>
      </Card>
      <Card>
        <ul className="divide-y divide-white/6">
          {rows.map((row) => (
            <li key={row.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13px] font-semibold">
                  {row.action === 'assigned' ? 'Assigned' : 'Released'} · {nameOf(row.assignedTo)}
                </p>
                <span className="shrink-0 text-[11.5px] text-white/35">{ago(row.occurredAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-white/45">
                {row.address}
                {row.subdivision ? ` · ${row.subdivision}` : ''} · score {row.scoreAtAssignment}
              </p>
              {row.reason && <p className="mt-0.5 text-[11.5px] text-white/35">{row.reason}</p>}
              <p className="mt-0.5 text-[11px] text-white/25">by {nameOf(row.actor)}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
