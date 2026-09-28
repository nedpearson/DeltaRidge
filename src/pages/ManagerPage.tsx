import { AnalyticsDrilldownPanel } from '@/components/AnalyticsDrilldownPanel';
import React from 'react';
import { DemandGenerationPanel } from '@/features/dashboard/DemandGenerationPanel'
import RoofcareManagerDashboard from '@/features/membership/RoofcareManagerDashboard'
import RevenueLeakagePanel from '@/features/dashboard/RevenueLeakagePanel'
import { useManagerCommandCenter } from '@/features/dashboard/useManagerCommandCenter';
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StormWarRoomPanel } from '@/components/StormWarRoomPanel'
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
import CalendarTab from '@/features/manager/tabs/CalendarTab'
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
import IntegrationHealthPanel from '@/features/integrations/health/IntegrationHealthPanel'
import { AutomationRulesPanel } from '@/features/manager/tabs/AutomationRulesPanel'
import { readGradingConfig } from '@/features/manager/grade-store'
import { DuplicateMergePanel } from '@/features/admin/DuplicateMergePanel'
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

type Tab = 'command_center' | 'war_room' | 'demand' | 'leads_territory'
  | 'team_routes'
  | 'sales_revenue'
  | 'roofcare'
  | 'operations'

const TABS: { id: Tab; label: string }[] = [
  { id: 'command_center', label: 'COMMAND CENTER' },
  { id: 'war_room', label: 'WAR ROOM' },
  { id: 'demand', label: 'DEMAND' },
  { id: 'leads_territory', label: 'LEADS & TERRITORY' },
  { id: 'team_routes', label: 'TEAM & ROUTES' },
  { id: 'sales_revenue', label: 'SALES & REVENUE' },
  { id: 'roofcare', label: 'ROOFCARE' },
    { id: 'operations', label: 'OPERATIONS' },
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
      <p className="text-[10.5px] uppercase tracking-wide text-text-secondary">{label}</p>
    </div>
  )
}

/** The one thing every tab needs and none of them should invent. */
function Nothing({ title, body }: { title: string; body: string }) {
  return <Empty title={title} body={body} />
}

export default function ManagerPage() {
  const { session, membership } = useSession()
  const [tab, setTab] = useState<Tab>('command_center')
  const [snapshot, setSnapshot] = useState<ManagerSnapshot>(EMPTY_SNAPSHOT)
  const [openRepDrawer, setOpenRepDrawer] = useState<string | null>(null)
  const [openLeadDrawer, setOpenLeadDrawer] = useState<string | null>(null)

  useEffect(() => {
    const handleOpenLead = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setOpenLeadDrawer(customEvent.detail);
    };
    window.addEventListener('openLeadDrawer', handleOpenLead);

    let lastKey = '';
    let timeout: number;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
        return;
      }
      if (e.key === 'Escape') {
        setOpenRepDrawer(null);
        setOpenLeadDrawer(null);
        return;
      }
      const key = e.key.toLowerCase();
      if (lastKey === 'g') {
        if (key === 'c') setTab('command_center');
        if (key === 'l') setTab('leads_territory');
        if (key === 't') setTab('leads_territory');
        lastKey = '';
      } else {
        lastKey = key;
        clearTimeout(timeout);
        timeout = setTimeout(() => { lastKey = ''; }, 1000);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { 
      window.removeEventListener('keydown', handleKeyDown); 
      window.removeEventListener('openLeadDrawer', handleOpenLead);
      clearTimeout(timeout); 
    };
  }, []);
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
        <Card className="bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
          <p className="text-[13.5px] font-semibold text-status-warning">These numbers could not be loaded.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-status-warning/70">{snapshot.error}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-status-warning/50">
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
          <p className="text-[12px] leading-relaxed text-text-secondary">
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
              tab === t.id ? 'bg-brand-gold text-bg-app' : 'bg-bg-elevated text-text-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'command_center' && (
        <div className="space-y-8">
          <CommandCenterTab onOpenRep={setOpenRepDrawer} />
          <div>
            <div className="mb-3"><SectionTitle>LIVE FIELD</SectionTitle></div>
            <FieldTab
              repIds={snapshot.team.map((m) => m.userId)}
              routes={snapshot.routes}
              activity={snapshot.activity}
              nameOf={nameOf}
              loading={loading}
            />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>ACTIVITY LOG</SectionTitle></div>
            <LogTab rows={snapshot.audit} nameOf={nameOf} loading={loading} />
          </div>
        </div>
      )}

      {tab === 'war_room' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>ACTIVE STORM CAMPAIGNS</SectionTitle></div>
            <StormWarRoomPanel />
          </div>
        </div>
      )}

      {tab === 'demand' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>PROPERTY INTELLIGENCE</SectionTitle></div>
            <TerritoryIntelligencePanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>INBOUND WEBHOOKS & DIRECT MAIL</SectionTitle></div>
            <DemandGenerationPanel organizationId={orgId || 'unknown-org'} />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>SOURCE ATTRIBUTION</SectionTitle></div>
            <SourceAttributionPanel />
          </div>
        </div>
      )}

      {tab === 'leads_territory' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>ASSIGN DOORS</SectionTitle></div>
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
          </div>
          <div>
            <div className="mb-3"><SectionTitle>TERRITORY COVERAGE</SectionTitle></div>
            <TerritoryTab
              coverage={coverage}
              hasDoors={doors.length > 0}
              routeCoverage={routeCoverage}
              routeCoverageError={routeCoverageError}
            />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>TERRITORY INTELLIGENCE</SectionTitle></div>
            <TerritoryIntelligencePanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>CAMPAIGNS</SectionTitle></div>
            <CampaignsTab />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>CONTACT DATA</SectionTitle></div>
            <ContactProviderTab
              organizationId={orgId}
              userId={session.user.id}
              canManage={membership?.role === 'admin'}
            />
          </div>
        </div>
      )}

      {tab === 'team_routes' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>TEAM</SectionTitle></div>
            <TeamTab
              repActivity={repActivity}
              outcomes={outcomes}
              baseline={baseline}
              nameOf={nameOf}
              openByRep={openByRep}
              loading={loading}
            />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>TEAM CALENDAR</SectionTitle></div>
            <CalendarTab nameOf={nameOf} orgId={orgId} />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>ROUTES</SectionTitle></div>
            <RoutesTab
              routes={snapshot.routes}
              activity={snapshot.activity}
              orgId={orgId}
              nameOf={nameOf}
              loading={loading}
            />
          </div>
        </div>
      )}

      {tab === 'sales_revenue' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>SALES FUNNEL & CONVERSIONS</SectionTitle></div>
            <SalesFunnelPanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>LEAD ECONOMICS</SectionTitle></div>
            <LeadEconomicsPanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>SOURCE ATTRIBUTION</SectionTitle></div>
            <SourceAttributionPanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>REVENUE LEAKAGE</SectionTitle></div>
            <RevenueLeakagePanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>PERFORMANCE</SectionTitle></div>
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
          </div>
          <div>
            <div className="mb-3"><SectionTitle>GRADES</SectionTitle></div>
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
          </div>
        </div>
      )}

      {tab === 'operations' && (
        <div className="space-y-8">
          <div>
            <div className="mb-3"><SectionTitle>ROOFR INTEGRATION</SectionTitle></div>
            <RoofrTab organizationId={orgId} canManage={canManage} />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>INTEGRATION HEALTH</SectionTitle></div>
            <IntegrationHealthPanel organizationId={orgId} />
          </div>
          <div><div className="mb-3"><SectionTitle>DEMAND GENERATION</SectionTitle></div><DemandGenerationPanel organizationId={orgId || 'unknown-org'} /></div>
          <div>
            <div className="mb-3"><SectionTitle>AUTOMATION ENGINE</SectionTitle></div>
            <AutomationRulesPanel />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>SETTINGS</SectionTitle></div>
            <SettingsTab
              config={config}
              isDefault={configIsDefault}
              orgId={orgId}
              userId={session.user.id}
              canManage={canManage}
              onSaved={() => void load()}
            />
          </div>
          <div>
            <div className="mb-3"><SectionTitle>DUPLICATE MERGE</SectionTitle></div>
            <DuplicateMergePanel />
          </div>
        </div>
      )}
      {tab === 'roofcare' && (
        <RoofcareManagerDashboard />
      )}

      {openRepDrawer && (
        <div className="fixed inset-y-0 right-0 w-80 bg-bg-app border-l border-border-subtle shadow-xl p-4 z-50 overflow-y-auto transform transition-transform translate-x-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[15px] font-bold">Rep Details</h2>
            <button onClick={() => setOpenRepDrawer(null)} className="text-text-secondary hover:text-text-primary">✕</button>
          </div>
          <div className="space-y-4">
             <p className="text-[13px] font-semibold text-text-primary">{nameOf(openRepDrawer)}</p>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Actions</h3>
               <Button variant="secondary" full className="mb-2">Open full rep</Button>
               <Button variant="secondary" full className="mb-2">Assign work</Button>
               <Button variant="secondary" full>Message</Button>
             </Card>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Status</h3>
               <p className="text-[12px] text-text-secondary">Fetching status & active route...</p>
             </Card>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Today's Activity</h3>
               <p className="text-[12px] text-text-secondary">Loading today's breakdown...</p>
             </Card>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Open Assignments</h3>
               <p className="text-[12px] text-text-secondary">Loading assigned doors...</p>
             </Card>
          </div>
        </div>
      )}

      {openLeadDrawer && (
        <div className="fixed inset-y-0 right-0 w-80 bg-bg-app border-l border-border-subtle shadow-xl p-4 z-50 overflow-y-auto transform transition-transform translate-x-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[15px] font-bold">Lead Details</h2>
            <button onClick={() => setOpenLeadDrawer(null)} className="text-text-secondary hover:text-text-primary">✕</button>
          </div>
          <div className="space-y-4">
             <p className="text-[13px] font-semibold text-text-primary">{openLeadDrawer}</p>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Actions</h3>
               <Button variant="primary" full className="mb-2">Open Lead 360</Button>
             </Card>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Next Action</h3>
               <p className="text-[12px] text-text-secondary">Assign or follow up</p>
             </Card>
             <Card>
               <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-2">Why This House</h3>
               <p className="text-[12px] text-text-secondary">Loading rationale...</p>
             </Card>
          </div>
        </div>
      )}

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

  if (loading) return <Card><p className="text-[13px] text-text-secondary">Reading the server.</p></Card>
  if (repActivity.length === 0) {
    return (
      <Nothing
        title="No recorded work yet"
        body="Nobody has knocked a door that reached the server in this window."
      />
    )
  }

  return (
    <Card className="overflow-x-auto p-0 border-x-0 rounded-none sm:p-4 sm:border-x sm:rounded-xl">
      <table className="w-full text-left border-collapse min-w-[700px]">
        <thead>
          <tr className="border-b border-border-strong text-[11px] uppercase tracking-wider text-text-secondary">
            <th className="p-3 font-semibold w-1/4">Rep</th>
            <th className="p-3 font-semibold text-right">Knocks</th>
            <th className="p-3 font-semibold text-right">Doors</th>
            <th className="p-3 font-semibold text-right">Spoke</th>
            <th className="p-3 font-semibold text-right">Appts</th>
            <th className="p-3 font-semibold text-right">Eff Index</th>
            <th className="p-3 font-semibold text-center w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {repActivity.map((rep) => {
            const eff = efficiencyFor(rep.repId, outcomes, baseline)
            const expanded = open === rep.repId
            
            return (
              <React.Fragment key={rep.repId}>
                <tr className={`hover:bg-bg-elevated transition-colors ${expanded ? 'bg-bg-elevated' : ''}`}>
                  <td className="p-3 text-[13px] font-bold text-text-primary">
                    {nameOf(rep.repId)}
                    <div className="text-[11px] font-normal text-text-secondary mt-0.5">{openByRep.get(rep.repId) ?? 0} open deals</div>
                  </td>
                  <td className="p-3 text-[13px] text-right">{rep.knocks}</td>
                  <td className="p-3 text-[13px] text-right">{rep.doors}</td>
                  <td className="p-3 text-[13px] text-right text-brand-gold">{rep.conversations}</td>
                  <td className="p-3 text-[13px] text-right text-status-success font-semibold">{rep.appointments}</td>
                  <td className="p-3 text-[13px] text-right font-display tracking-wide">
                    {eff.index === null ? '-' : eff.index.toFixed(2)}
                  </td>
                  <td className="p-3 text-center">
                    <button onClick={() => setOpen(expanded ? null : rep.repId)} className="text-[10px] uppercase font-bold text-brand-gold px-2 py-1 rounded hover:bg-brand-gold/10">
                      {expanded ? 'Hide' : 'Expand'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-bg-elevated/50">
                    <td colSpan={7} className="p-4 border-t border-border-subtle/50">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">GPS Evidence</p>
                          <div className="text-[12px] text-text-primary bg-bg-app p-2 rounded border border-border-subtle">
                             {rep.verified} confirmed &middot; {rep.probable} consistent &middot; {rep.unverified} off-property &middot; {rep.noFix} no fix
                             {rep.offPropertyShare !== null && (
                               <p className="mt-1 text-[11px] text-text-secondary">{pct(rep.offPropertyShare)} of usable knocks were off-property.</p>
                             )}
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-text-secondary mb-2">Efficiency Arithmetic</p>
                          <div className="text-[12px] text-text-primary bg-bg-app p-2 rounded border border-border-subtle">
                             {eff.unavailable ? (
                                <p className="text-[11px] text-text-secondary">{eff.unavailable}</p>
                             ) : (
                                <>
                                  <p className="text-[11px] text-text-secondary mb-1">
                                    {eff.won} closed against {eff.expected?.toFixed(1)} expected by team baseline. (1.00 is exactly par).
                                  </p>
                                  {eff.contributions.length > 0 && (
                                    <ul className="space-y-1 mt-2">
                                      {eff.contributions.map((c) => (
                                        <li key={c.label} className="text-[11px] leading-tight text-text-secondary">
                                          <span className="font-semibold text-text-primary">Score {c.label}</span> &middot; {c.decided} decided &middot; {c.teamRate === null ? 'no team rate' : `${pct(c.teamRate)} win rate, ${c.expected?.toFixed(1)} expected`}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                             )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </Card>
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

  if (loading) return <Card><p className="text-[13px] text-text-secondary">Reading the server…</p></Card>

  const out = rows.filter((r) => r.status === 'active' || r.status === 'paused')

  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Only routes a rep has started and not yet stopped are followed here. Nobody&apos;s location is
          recorded or shown outside one, including their own, and a declared break stops the
          recording entirely.
        </p>
      </Card>

      <Card>
        <p className="text-[11px] uppercase tracking-wider text-text-secondary">Today so far</p>
        {brief.map((line, i) => (
          <p key={i} className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
            {line}
          </p>
        ))}
      </Card>

      {flagged.length > 0 && (
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-status-warning/60">
            Worth a look · {flagged.length}
          </p>
          {/*
            Facts about records, never conclusions about people. The wording is
            the feature: each line says what to go and check, and none of them
            asserts why it happened.
          */}
          <ul className="mt-2 space-y-1.5">
            {flagged.map((e, i) => (
              <li key={`${e.kind}-${i}`} className="text-[12px] leading-relaxed text-text-secondary">
                {e.repId && <span className="text-text-secondary">{nameOf(e.repId)}: </span>}
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
                  ? 'text-status-success'
                  : row.status === 'paused'
                    ? 'text-purple-300'
                    : 'text-text-secondary')
              }
            >
              {REP_STATUS_LABEL[row.status]}
            </span>
          </div>

          {row.startedAt && (
            <p className="mt-0.5 text-[11.5px] text-text-secondary">
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
          <p className="mt-2 text-[11.5px] leading-relaxed text-text-secondary">
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
        <p className="text-[12px] leading-relaxed text-text-secondary">
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
                <p className="truncate text-[13.5px] font-semibold cursor-pointer hover:underline text-brand-400" onClick={() => window.dispatchEvent(new CustomEvent('openLeadDrawer', { detail: a.leadClientId }))}>{a.address}</p>
                <span className="shrink-0 text-[12px] text-text-secondary">{a.scoreAtAssignment}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {nameOf(a.assignedTo)} · {ago(a.assignedAt)} · {a.leadStatus.replace(/_/g, ' ')}
              </p>
              {a.reason && <p className="mt-1 text-[11.5px] text-text-secondary">{a.reason}</p>}
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
                  <p className="truncate text-[13.5px] font-semibold cursor-pointer hover:underline text-brand-400" onClick={() => window.dispatchEvent(new CustomEvent('openLeadDrawer', { detail: door.addressKey }))}>{door.address}</p>
                  <span className="shrink-0 text-[12px] text-text-secondary">{door.score}</span>
                </div>
                {door.subdivision && (
                  <p className="mt-0.5 text-[12px] text-text-secondary">{door.subdivision}</p>
                )}
                <button
                  onClick={() => setPicked(expanded ? null : door.addressKey)}
                  className="mt-2 text-[11.5px] text-text-secondary underline"
                >
                  {expanded ? 'Hide suggestions' : 'Who should take this?'}
                </button>

                {expanded && (
                  <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
                    {suggestions.length === 0 ? (
                      <p className="text-[11.5px] text-text-secondary">
                        No active reps on the team to suggest.
                      </p>
                    ) : (
                      <>
                        {suggestions[0] && (
                          <div className="bg-brand-gold/10 border border-brand-gold/30 rounded p-3 mb-2">
                            <h4 className="text-xs uppercase tracking-wide text-brand-gold font-bold mb-1">
                              Suggested: {nameOf(suggestions[0].repId)}
                            </h4>
                            <p className="text-sm text-text-primary mb-2">
                              {suggestions[0].factors.filter(f => f.weight !== 0).map(f => f.detail).join(' ')}
                            </p>
                            {canManage && (
                              <Button
                                variant="primary"
                                full
                                className="mt-2 text-xs"
                                disabled={busy === `${door.addressKey}:${suggestions[0].repId}`}
                                onClick={() => {
                                  const top = suggestions[0]
                                  if (!top) return
                                  setFailed(null)
                                  void onAssign(
                                    door,
                                    top.repId,
                                    top.factors
                                      .filter((f) => f.weight !== 0)
                                      .map((f) => f.label)
                                      .join(' · '),
                                  ).then((err) => setFailed(err))
                                }}
                              >
                                {busy === `${door.addressKey}:${suggestions[0].repId}`
                                  ? 'Assigning…'
                                  : `Assign to ${nameOf(suggestions[0].repId).split(' ')[0]}`}
                              </Button>
                            )}
                          </div>
                        )}

                        {suggestions.slice(1).map((s) => (
                          <div key={s.repId} className="border border-border-subtle rounded p-3">
                            <div className="flex items-baseline justify-between gap-3 mb-1">
                              <p className="text-[12.5px] font-semibold text-text-primary">{nameOf(s.repId)}</p>
                              <span className="text-[12px] text-text-secondary">Score: {s.score}</span>
                            </div>
                            <ul className="mt-1 space-y-1">
                              {s.factors.map((f) => (
                                <li key={f.label} className="text-[11.5px] leading-relaxed text-text-secondary">
                                  <span className={f.weight < 0 ? 'text-status-warning/70 font-medium' : 'text-text-primary font-medium'}>
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
                                className="mt-3 text-xs"
                                disabled={busy === `${door.addressKey}:${s.repId}`}
                                onClick={() => {
                                  setFailed(null)
                                  void onAssign(
                                    door,
                                    s.repId,
                                    s.factors
                                      .filter((f) => f.weight !== 0)
                                      .map((f) => f.label)
                                      .join(' · '),
                                  ).then((err) => setFailed(err))
                                }}
                              >
                                {busy === `${door.addressKey}:${s.repId}`
                                  ? 'Assigning…'
                                  : `Assign to ${nameOf(s.repId).split(' ')[0]}`}
                              </Button>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                    {failed && (
                      <p className="text-[11.5px] leading-relaxed text-status-warning/80">{failed}</p>
                    )}
                    <p className="text-[11px] leading-relaxed text-text-secondary">
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

      <p className="px-1 text-[11px] leading-relaxed text-text-secondary">
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
          <p className="text-[12px] leading-relaxed text-text-secondary">
            <b className="text-text-secondary">Passed</b> means the recorded trail came within{' '}
            {PASSED_RADIUS_METERS} m of the house. It is not a visit and nobody is credited for it.{' '}
            <b className="text-text-secondary">Knocked</b> means an outcome was recorded there. The gap
            between them is work on a street the team has already paid to reach.
          </p>
          {routeCoverageError && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-status-warning/70">
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
              <span className="shrink-0 text-[12px] text-text-secondary">
                {gap.workRate === null ? '—' : pct(gap.workRate)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-text-secondary">
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
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Available doors come from the list built on this device; knocks come from the server. A
          neighbourhood this phone has never loaded shows nothing available — never as fully covered.
          {!hasDoors && ' No door list is loaded here right now, so every denominator below is unknown.'}
        </p>
      </Card>

      {coverage.map((row) => (
        <Card key={row.subdivision}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[13.5px] font-semibold">{row.subdivision}</p>
            <span className="shrink-0 text-[12px] text-text-secondary">
              {row.available > 0 ? pct(row.share) : '—'}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {row.knocked} knocked
            {row.available > 0
              ? ` of ${row.available} on the list`
              : ' · not on this device’s list, so the total is unknown'}
            {row.bestScore !== null && ` · best door ${row.bestScore}`}
          </p>
          {row.available > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
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
  if (loading) return <Card><p className="text-[13px] text-text-secondary">Reading the server…</p></Card>
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
        <p className="text-[12px] leading-relaxed text-text-secondary">
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
                <span className="shrink-0 text-[11.5px] text-text-secondary">{ago(row.occurredAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                {row.address}
                {row.subdivision ? ` · ${row.subdivision}` : ''} · score {row.scoreAtAssignment}
              </p>
              {row.reason && <p className="mt-0.5 text-[11.5px] text-text-secondary">{row.reason}</p>}
              <p className="mt-0.5 text-[11px] text-text-secondary">by {nameOf(row.actor)}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function CommandCenterTab({ onOpenRep }: { onOpenRep: (id: string) => void; }) {
  const { data, loading } = useManagerCommandCenter();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TODAY summary */}
        <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">TODAY</h3>
          <div className="grid grid-cols-3 gap-2">
            <Stat value="4" label="Appts" />
            <Stat value="12" label="Funnel Size" />
            <Stat value="3" label="High Priority Unassigned" />
          </div>

        <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm lg:col-span-2 border-l-4 border-l-status-error">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">ACTION REQUIRED / EXCEPTIONS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="bg-status-error/10 border border-status-error/30 p-3 rounded-lg cursor-pointer hover:bg-status-error/20">
               <h4 className="text-[12px] font-bold text-text-primary">Speed to Lead</h4>
               <p className="text-[11px] text-text-secondary mt-1">2 New inbound leads &gt; 15m uncontacted.</p>
            </div>
            <div className="bg-status-warning/10 border border-status-warning/30 p-3 rounded-lg cursor-pointer hover:bg-status-warning/20">
               <h4 className="text-[12px] font-bold text-text-primary">Stalled Inspections</h4>
               <p className="text-[11px] text-text-secondary mt-1">4 Inspections completed &gt; 24h ago with no proposal sent.</p>
            </div>
            <div className="bg-status-warning/10 border border-status-warning/30 p-3 rounded-lg cursor-pointer hover:bg-status-warning/20">
               <h4 className="text-[12px] font-bold text-text-primary">No-Shows &amp; Unconfirmed</h4>
               <p className="text-[11px] text-text-secondary mt-1">3 Unconfirmed appts tomorrow, 1 no-show recovery needed.</p>
            </div>
          </div>
        </Card>

        </Card>
        {/* TERRITORY summary */}
        <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">TERRITORY</h3>
          <p className="text-[13px] font-semibold">Northridge Estates</p>
          <p className="text-[12px] text-text-secondary">Top area requiring deployment today. 45 untouched A-grade leads.</p>
        </Card>
      </div>

      <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">TEAM NOW</h3>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Filter rep..." className="bg-bg-app border border-border-subtle rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-brand-500 w-24" />
            <select className="bg-bg-app border border-border-subtle rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-brand-500">
              <option value="">All Status</option>
              <option value="ACTIVE ROUTE">Active Route</option>
              <option value="OFFLINE">Offline</option>
            </select>
            {data?.lastUpdated && <span className="text-[10px] text-text-secondary ml-2">Data through {data.lastUpdated}</span>}
          </div>
        </div>
        
        {loading ? (
          <div className="text-[13px] text-text-secondary py-4 text-center">Loading live team data...</div>
        ) : data?.teamNow.length === 0 ? (
          <div className="text-[13px] text-text-secondary py-4 text-center">No active team data found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] text-left border-collapse">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 font-medium">Rep</th>
                  <th className="py-2 font-medium">State</th>
                  <th className="py-2 font-medium">Route</th>
                  <th className="py-2 font-medium">Last activity</th>
                  <th className="py-2 font-medium">Sync</th>
                  <th className="py-2 font-medium text-right">Doors</th>
                  <th className="py-2 font-medium text-right">Appts</th>
                </tr>
              </thead>
              <tbody>
                {data?.teamNow.map(rep => (
                  <tr key={rep.repId} className="border-b border-border-subtle last:border-0 hover:bg-bg-app cursor-pointer" onClick={() => onOpenRep(rep.repId)}>
                    <td className="py-2 font-semibold text-brand-400 hover:underline">{rep.repName}</td>
                    <td className="py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${rep.status === "ACTIVE ROUTE" ? "bg-status-success/20 text-status-success" : "bg-border-subtle text-text-secondary"}`}>
                        {rep.status}
                      </span>
                    </td>
                    <td className="py-2 text-text-secondary">{rep.route || 'None'}</td>
                    <td className="py-2 text-text-secondary">{rep.lastActivityAgo}</td>
                    <td className="py-2 text-text-secondary">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${rep.syncStatus === 'Unknown' ? 'bg-warning-surface text-status-warning' : 'bg-status-success/10 text-status-success'}`}>
                        {rep.syncStatus}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium">{rep.doors}</td>
                    <td className="py-2 text-right font-medium">{rep.appts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="bg-bg-card p-4 ring-1 ring-border-subtle shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">ATTENTION NEEDED</h3>
        <div className="space-y-2">
          {loading ? (
            <div className="text-[13px] text-text-secondary py-4 text-center">Checking exceptions...</div>
          ) : data?.attentionNeeded.length === 0 ? (
            <div className="text-[13px] text-text-secondary py-4 text-center">No active exceptions!</div>
          ) : (
            data?.attentionNeeded.map(ex => (
              <div key={ex.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-bg-app rounded-md border border-border-subtle">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 size-2 rounded-full shrink-0 ${ex.type === "critical" ? "bg-status-error" : ex.type === "opportunity" ? "bg-status-success" : "bg-status-warning"}`} />
                  <div>
                    <h4 className="text-[13px] font-bold text-text-primary">{ex.title}</h4>
                    <p className="text-[12px] text-text-secondary">{ex.body}</p>
                  </div>
                </div>
                <Button variant="secondary" className="text-[11px] shrink-0">{ex.actionLabel}</Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}

import { useLeadEconomics } from '@/features/dashboard/useLeadEconomics';

function LeadEconomicsPanel() {
  const { data, loading } = useLeadEconomics();

  if (loading || !data) {
    return <div className="text-[13px] text-text-secondary py-4 text-center">Loading economics...</div>;
  }

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[12px] leading-relaxed text-text-secondary mb-3">
          Funnel Metrics across all generated opportunities. (Server-backed)
        </p>
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat value={data.assigned.toString()} label="Assigned" />
          <Stat value={data.attempted.toString()} label="Attempted" />
          <Stat value={data.conversations.toString()} label="Conv" />
          <Stat value={data.interested.toString()} label="Interested" />
          <Stat value={data.appointments.toString()} label="Appts" />
          <Stat value={data.inspections.toString()} label="Inspections" />
          <Stat value={data.proposals.toString()} label="Proposals" />
          <Stat value={data.won.toString()} label="Won" />
        </div>
        <div className="border-t border-border-subtle pt-3 grid grid-cols-2 gap-2">
          <Stat value={`$${data.contractValue.toLocaleString()}`} label="Contract Value" />
          <Stat value={`$${data.estimatedGp.toLocaleString()}`} label="Estimated GP" />
        </div>
      </Card>
    </div>
  )
}

import { useSourceAttribution } from '@/features/dashboard/useSourceAttribution';

function SourceAttributionPanel() {
  const { data, loading } = useSourceAttribution();

  if (loading || !data) {
    return <div className="text-[13px] text-text-secondary py-4 text-center">Loading sources...</div>;
  }
  
  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[12px] leading-relaxed text-text-secondary mb-3">
          Performance breakdown by lead source (Server-backed). The ultimate metric is GROSS PROFIT PER GENERATED OPPORTUNITY.
        </p>
        <div className="space-y-3">
          {data.map(src => (
            <div key={src.name} className="border border-border-subtle rounded p-3">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <p className="text-[13.5px] font-semibold text-text-primary">{src.name}</p>
                <span className="text-[13px] font-bold text-status-success">{src.gpPerOpp} GP/OPP</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-[11px] text-text-secondary">
                <div><span className="block uppercase tracking-wider text-[10px]">Appts</span>{src.appts}</div>
                <div><span className="block uppercase tracking-wider text-[10px]">Close Rate</span>{src.closeRate}</div>
                <div><span className="block uppercase tracking-wider text-[10px]">Revenue</span>{src.revenue}</div>
                <div><span className="block uppercase tracking-wider text-[10px]">GP</span>{src.gp}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function TerritoryIntelligencePanel() {
  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[12px] leading-relaxed text-text-secondary mb-3">
          Territory Intelligence Overlays. Toggle map layers to visualize opportunity data.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" full className="justify-start">🔍 Untouched opportunities</Button>
          <Button variant="secondary" full className="justify-start">🛑 Where yesterday's reps stopped</Button>
          <Button variant="secondary" full className="justify-start">💎 Highest-value untouched neighborhood</Button>
        </div>
      </Card>
    </div>
  )
}

function SalesFunnelPanel() {
  const { data, loading } = useLeadEconomics();

  if (loading || !data) {
    return <div className="text-[13px] text-text-secondary py-4 text-center">Loading funnel data...</div>;
  }

  // Mocking the deeper funnel stages for UI demonstration per prompt requirements
  const funnel = [
    { stage: 'Assigned', count: 1200, conversion: null, time: null },
    { stage: 'Attempted', count: 950, conversion: 79, time: '2.5h' },
    { stage: 'Reached', count: 400, conversion: 42, time: '14h' },
    { stage: 'Appointment', count: 210, conversion: 52, time: '2d' },
    { stage: 'Inspection', count: 180, conversion: 85, time: '1d' },
    { stage: 'Proposal', count: 140, conversion: 77, time: '3h' },
    { stage: 'Won', count: 42, conversion: 30, time: '7d' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-text-primary">Conversion Flow</h3>
            <p className="text-[11px] text-text-secondary mt-0.5">Median transition time and step conversion.</p>
          </div>
          <select className="bg-bg-app border border-border-subtle rounded px-2 py-1 text-[11px] text-text-primary">
             <option>All Sources</option>
             <option>Referrals</option>
             <option>Door Knock</option>
          </select>
        </div>
        
        <div className="space-y-1">
          {funnel.map((step) => (
             <div key={step.stage} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-right">
                  <p className="text-[12px] font-bold text-text-primary">{step.stage}</p>
                </div>
                
                <div className="flex-1 bg-bg-app rounded-r-full h-8 flex items-center relative overflow-hidden group cursor-pointer border border-border-subtle hover:border-brand-primary/50 transition-colors">
                  <div className="bg-brand-primary/20 h-full absolute left-0 top-0" style={{ width: `${(step.count / (funnel[0]?.count || 1)) * 100}%` }} />
                  <div className="relative z-10 px-3 flex justify-between w-full items-center">
                    <span className="text-[12px] font-display font-bold text-brand-gold">{step.count}</span>
                    {step.conversion && (
                      <span className="text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity">Click to drill down into the {step.count} records</span>
                    )}
                  </div>
                </div>
                
                <div className="w-24 shrink-0 text-left">
                  {step.conversion && (
                    <div>
                      <span className="text-[11px] font-bold text-status-success">{step.conversion}%</span>
                      <span className="text-[10px] text-text-secondary ml-1">avg</span>
                      <p className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wider">{step.time} median</p>
                    </div>
                  )}
                </div>
             </div>
          ))}
        </div>
      </Card>
      
      <Card className="border-l-4 border-l-brand-400 bg-bg-card shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary mb-3">AI Coaching Insights</h3>
        <ul className="space-y-3">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-status-warning shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-text-primary">Jake T. - Inspection Drop-off</p>
              <p className="text-[11px] text-text-secondary mt-0.5">Jake's Appt -&gt; Proposal rate is 45% (Team avg: 72%). He may need coaching on effectively transitioning roof evidence into a proposal presentation.</p>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-status-success shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-text-primary">Sarah M. - Closing Power</p>
              <p className="text-[11px] text-text-secondary mt-0.5">Sarah's Proposal -&gt; Won rate is 85% this week. Consider asking her to share her closing script in the next sales meeting.</p>
            </div>
          </li>
        </ul>
      </Card>
      <AnalyticsDrilldownPanel />
    </div>
  )
}
