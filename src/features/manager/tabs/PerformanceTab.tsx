import { useMemo, useState } from 'react'
import { Card, SectionTitle } from '@/components/ui'
import { Figure, Nothing, Stat, duration, pct } from './shared'
import { performanceFor, pooled, type AssignedLead, type RepPerformance } from '../performance'
import { MISSING_SEGMENTS, byScoreBand, bySubdivision, standout } from '../segments'
import type { ActivityRow, BandRate, RouteRow } from '../metrics'
import ManagerLeadEvidence from '@/features/manager/ManagerLeadEvidence'

/**
 * One rep's record, and the team's, with the arithmetic in view.
 *
 * Every rate on this screen is drawn through `Figure`, which renders the reason
 * there is no number in the same place and at the same weight the number would
 * have had. That is the whole design: a manager should leave this screen either
 * knowing a figure or knowing why there isn't one, never with a vague
 * impression that somebody's contact rate was "low".
 */

export default function PerformanceTab({
  team,
  activity,
  routes,
  assignments,
  baseline,
  nameOf,
  windowFrom,
  windowTo,
  onOpenLead,
}: {
  team: readonly { userId: string; role: string; isActive: boolean }[]
  activity: readonly ActivityRow[]
  routes: readonly RouteRow[]
  assignments: readonly AssignedLead[]
  baseline: readonly BandRate[]
  nameOf: (id: string | null) => string
  windowFrom: string
  windowTo: string
  onOpenLead: (leadId: string) => void
}) {
  const reps = useMemo(
    () => team.filter((m) => m.isActive && m.role !== 'office').map((m) => m.userId),
    [team],
  )
  const [selected, setSelected] = useState<string | null>(null)

  const all = useMemo(
    () =>
      reps.map((repId) =>
        performanceFor({
          repId,
          from: windowFrom,
          to: windowTo,
          activity,
          routes,
          assignments,
          baseline,
        }),
      ),
    [reps, activity, routes, assignments, baseline, windowFrom, windowTo],
  )

  const teamRates = useMemo(
    () => ({
      contact: pooled(all.map((p) => p.doors.contactRate), 40, 'knocks'),
      appointment: pooled(all.map((p) => p.doors.appointmentRate), 15, 'conversations'),
      inspection: pooled(all.map((p) => p.sales.inspectionRate), 10, 'appointments'),
      contract: pooled(all.map((p) => p.sales.contractRate), 8, 'inspections'),
      followUp: pooled(all.map((p) => p.followUp.completionRate), 10, 'follow-ups'),
    }),
    [all],
  )

  if (reps.length === 0) {
    return (
      <Nothing
        title="Nobody to measure yet"
        body="This reads the organisation's member list. Once somebody is on the team and has worked doors, their record appears here."
      />
    )
  }

  const chosen = selected ? all.find((p) => p.repId === selected) : null

  return (
    <div className="space-y-3">
      <SectionTitle>TEAM RATES</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Figure
            value={teamRates.contact.value === null ? null : pct(teamRates.contact.value)}
            unavailable={teamRates.contact.unavailable}
            label="doors answered"
          />
          <Figure
            value={teamRates.appointment.value === null ? null : pct(teamRates.appointment.value)}
            unavailable={teamRates.appointment.unavailable}
            label="conversations booked"
          />
          <Figure
            value={teamRates.inspection.value === null ? null : pct(teamRates.inspection.value)}
            unavailable={teamRates.inspection.unavailable}
            label="appointments inspected"
          />
          <Figure
            value={teamRates.contract.value === null ? null : pct(teamRates.contract.value)}
            unavailable={teamRates.contract.unavailable}
            label="inspections sold"
          />
        </div>
        <p className="mt-3 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-white/35">
          Pooled across the team, not averaged across reps — averaging lets somebody with four doors count
          as much as somebody with four hundred. There is no industry benchmark anywhere on this screen:
          Delta Ridge's own numbers are the only honest expectation for a Delta Ridge rep.
        </p>
      </Card>

      <SectionTitle hint="tap a rep">RANKINGS</SectionTitle>
      <div className="space-y-2">
        {[...all]
          .sort((a, b) => b.field.knocks - a.field.knocks)
          .map((rep) => (
            <button key={rep.repId} onClick={() => setSelected(rep.repId === selected ? null : rep.repId)} className="w-full text-left">
              <Card className={selected === rep.repId ? 'ring-gold-400/40' : ''}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[14px] font-semibold">{nameOf(rep.repId)}</p>
                  <span className="shrink-0 text-[11px] text-white/35">
                    {rep.field.routesCompleted} route{rep.field.routesCompleted === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                  <Stat value={String(rep.field.doors)} label="doors" />
                  <Stat value={String(rep.doors.conversations)} label="spoke" />
                  <Stat value={String(rep.doors.appointments)} label="booked" />
                  <Stat value={String(rep.sales.contracts)} label="sold" />
                </div>
              </Card>
            </button>
          ))}
      </div>

      {chosen && (
        <RepDetail
          rep={chosen}
          nameOf={nameOf}
          assignments={assignments}
          activity={activity}
          teamRates={teamRates}
          onOpenLead={onOpenLead}
        />
      )}
    </div>
  )
}

function RepDetail({
  rep,
  nameOf,
  assignments,
  activity,
  teamRates,
  onOpenLead,
}: {
  rep: RepPerformance
  nameOf: (id: string | null) => string
  assignments: readonly AssignedLead[]
  activity: readonly ActivityRow[]
  onOpenLead: (leadId: string) => void
  teamRates: {
    contact: { value: number | null; unavailable: string | null }
    appointment: { value: number | null; unavailable: string | null }
    inspection: { value: number | null; unavailable: string | null }
    contract: { value: number | null; unavailable: string | null }
    followUp: { value: number | null; unavailable: string | null }
  }
}) {
  const mine = assignments.filter((a) => a.repId === rep.repId)
  const myActivity = activity.filter(
    (row) => row.userId === rep.repId && row.occurredAt >= rep.from && row.occurredAt <= rep.to,
  )
  const [evidence, setEvidence] = useState<
    'all' | 'knocked' | 'appointments' | 'inspections' | 'sold' | 'overdue' | null
  >(null)
  const bands = byScoreBand(mine)
  const areas = bySubdivision(mine)
  const best = standout([...bands, ...areas])

  return (
    <div className="space-y-3">
      <SectionTitle>{nameOf(rep.repId).toUpperCase()}</SectionTitle>

      <Card>
        <p className="text-[12px] font-semibold text-white/70">FIELD</p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <Stat value={String(rep.field.routesStarted)} label="routes" />
          <Stat value={duration(rep.field.fieldSeconds)} label="field time" />
          <Stat value={String(rep.field.verifiedKnocks)} label="verified" />
        </div>
        <div className="mt-3">
          <Figure
            value={
              rep.field.knocksPerFieldHour.value === null
                ? null
                : `${rep.field.knocksPerFieldHour.value.toFixed(1)}/h`
            }
            unavailable={rep.field.knocksPerFieldHour.unavailable}
            label="doors per field hour"
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          Field time is start-to-stop on completed routes. It is not "time worked" and is never graded on
          directly — a longer timer is not more selling.
        </p>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-white/70">DOORS</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Figure
            value={rep.doors.contactRate.value === null ? null : pct(rep.doors.contactRate.value)}
            unavailable={rep.doors.contactRate.unavailable}
            label={`answered of ${rep.doors.contactRate.denominator} knocks`}
          />
          <Figure
            value={rep.doors.appointmentRate.value === null ? null : pct(rep.doors.appointmentRate.value)}
            unavailable={rep.doors.appointmentRate.unavailable}
            label={`booked of ${rep.doors.appointmentRate.denominator} conversations`}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          Booking rate is measured against conversations, not knocks. Dividing by knocks would make a rep
          who works empty streets look like a poor closer. Team: {teamRates.contact.value === null ? 'no rate yet' : pct(teamRates.contact.value)} answered,{' '}
          {teamRates.appointment.value === null ? 'no rate yet' : pct(teamRates.appointment.value)} booked.
        </p>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-white/70">SALES</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Figure
            value={rep.sales.inspectionRate.value === null ? null : pct(rep.sales.inspectionRate.value)}
            unavailable={rep.sales.inspectionRate.unavailable}
            label="appointments inspected"
          />
          <Figure
            value={rep.sales.contractRate.value === null ? null : pct(rep.sales.contractRate.value)}
            unavailable={rep.sales.contractRate.unavailable}
            label="inspections sold"
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          Revenue and gross profit are not here. They live on the estimate, and no estimate in this system
          has been tied to a lead outcome yet — showing a currency figure that nothing computed would be
          worse than showing none.
        </p>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-white/70">FOLLOW-UP</p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <Stat value={String(rep.followUp.due)} label="came due" />
          <Stat value={String(rep.followUp.completed)} label="done" />
          <Stat value={String(rep.followUp.overdue)} label="still open" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          A follow-up counts as done when something was recorded against that lead after the date the rep
          set themselves. It says nothing about how the conversation went — the app cannot see a phone
          call.
        </p>
      </Card>

      <Card>
        <p className="text-[12px] font-semibold text-white/70">SUPPORTING RECORDS</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/30">
          Every performance figure below can be checked against the actual lead records. These buttons
          filter records; they do not recalculate the metric.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            ['all', `All assigned · ${mine.length}`],
            ['knocked', `Knocked · ${rep.doors.knocked}`],
            ['appointments', `Appointments · ${rep.doors.appointments}`],
            ['inspections', `Inspected · ${rep.sales.inspections}`],
            ['sold', `Sold · ${rep.sales.contracts}`],
            ['overdue', `Overdue · ${rep.followUp.overdue}`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setEvidence(evidence === key ? null : (key as typeof evidence))
              }
              className={`rounded-xl px-3 py-2 text-left text-[11.5px] ring-1 ${
                evidence === key
                  ? 'bg-gold-500/15 text-gold-200 ring-gold-400/30'
                  : 'bg-white/4 text-white/55 ring-white/8'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {evidence && (
        <ManagerLeadEvidence
          title={`${nameOf(rep.repId)} · ${evidence}`}
          leads={(() => {
            const addressByLead = new Map(myActivity.map((row) => [row.leadClientId, row.address]))
            const now = Date.now()

            if (evidence === 'knocked') {
              return myActivity
                .filter((row) => row.activityType === 'door_knock')
                .map((row) => ({
                  leadId: row.leadClientId,
                  address: row.address,
                  detail: `Knocked ${new Date(row.occurredAt).toLocaleString()} · ${row.outcome ?? 'outcome not recorded'}`,
                }))
            }

            const filtered = mine.filter((lead) => {
              if (evidence === 'all') return true
              if (evidence === 'appointments') {
                return lead.status === 'appointment' || lead.status === 'inspected' || lead.status === 'proposal_pending' || lead.status === 'sold'
              }
              if (evidence === 'inspections') {
                return lead.status === 'inspected' || lead.status === 'proposal_pending' || lead.status === 'sold'
              }
              if (evidence === 'sold') return lead.status === 'sold'
              if (evidence === 'overdue') {
                if (!lead.nextActionAt) return false
                const due = Date.parse(lead.nextActionAt)
                const last = lead.lastActivityAt ? Date.parse(lead.lastActivityAt) : Number.NaN
                return Number.isFinite(due) && due <= now && (!Number.isFinite(last) || last < due)
              }
              return false
            })

            return filtered.map((lead) => ({
              leadId: lead.leadClientId,
              address: addressByLead.get(lead.leadClientId) ?? 'Address available in Lead 360',
              detail: [
                lead.status.replaceAll('_', ' '),
                `assigned score ${lead.scoreAtAssignment}`,
                lead.nextActionAt ? `next action ${new Date(lead.nextActionAt).toLocaleString()}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }))
          })()}
          onOpenLead={onOpenLead}
          onClose={() => setEvidence(null)}
        />
      )}

      <Card>
        <p className="text-[12px] font-semibold text-white/70">THE DOORS THEY WERE GIVEN</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Figure
            value={rep.quality.averageScore === null ? null : rep.quality.averageScore.toFixed(0)}
            unavailable="No assigned doors in this window."
            label="average score at assignment"
          />
          <Figure
            value={rep.quality.efficiency.index === null ? null : rep.quality.efficiency.index.toFixed(2)}
            unavailable={rep.quality.efficiency.unavailable}
            label="against doors of the same score"
          />
        </div>
        {rep.quality.efficiency.contributions.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-white/5 pt-2">
            {rep.quality.efficiency.contributions.map((c) => (
              <p key={c.label} className="text-[11.5px] text-white/45">
                Score {c.label}: {c.decided} decided, {c.actual} won
                {c.expected === null
                  ? ' — the team has no rate at this score to compare against'
                  : ` against ${c.expected.toFixed(1)} the team's own rate would predict`}
              </p>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-white/30">
          1.00 means they did exactly what those doors were worth. This is the only figure here that holds
          lead quality constant, which is why the score is frozen at the moment a door is handed over.
        </p>
      </Card>

      {(bands.length > 0 || areas.length > 0) && (
        <Card>
          <p className="text-[12px] font-semibold text-white/70">WHERE THEY ARE STRONGEST</p>
          {best.strongest && best.weakest ? (
            <div className="mt-2 space-y-1">
              <p className="text-[12.5px]">
                Strongest: {best.strongest.label} — {best.strongest.won} of {best.strongest.decided} decided
              </p>
              <p className="text-[12.5px] text-white/60">
                Weakest: {best.weakest.label} — {best.weakest.won} of {best.weakest.decided} decided
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-white/40">
              Not enough decided doors in two different segments to say where they are strongest. One
              qualifying segment reads like a finding and contains none.
            </p>
          )}
          <div className="mt-3 border-t border-white/5 pt-2">
            <p className="text-[11px] font-medium text-white/40">Splits this system cannot make yet</p>
            {MISSING_SEGMENTS.map((missing) => (
              <p key={missing.name} className="mt-1 text-[11px] leading-relaxed text-white/30">
                {missing.name} — needs {missing.needs}
              </p>
            ))}
          </div>
        </Card>
      )}

      {rep.completeness.notes.length > 0 && (
        <Card className="!bg-amber-500/6 ring-amber-500/15">
          <p className="text-[12px] font-semibold text-amber-200/90">What is missing from this window</p>
          {rep.completeness.notes.map((note) => (
            <p key={note} className="mt-1 text-[11.5px] leading-relaxed text-amber-100/60">
              {note}
            </p>
          ))}
          <p className="mt-2 text-[11px] text-amber-100/40">
            Data completeness {pct(rep.completeness.score)}. This feeds straight into the confidence on any
            grade computed from this window.
          </p>
        </Card>
      )}

      {/*
        No trend line here yet, deliberately. A trend needs two full windows
        that both cleared their sample floors, and this system has one. The
        machinery exists (features/manager/trends.ts) and switches on the first
        time a rep has two comparable months; until then a rising arrow would
        be decoration.
      */}
      <p className="text-[10.5px] leading-relaxed text-white/25">
        No trend yet: comparing windows needs two of them, both above their sample floors. This is the
        first.
      </p>
    </div>
  )
}
