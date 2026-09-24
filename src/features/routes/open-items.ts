import { isDue, type ManagedLead } from '@/features/leads/pipeline'
import type { DoorEvent } from './route-stats'

/**
 * What the rep is leaving unfinished.
 *
 * This is the part of the end-of-day report that is actually worth reading. A
 * recap of what happened is pleasant; a list of what is still open is the thing
 * that stops a booked appointment with no date, or an inspection nobody turned
 * into an estimate, from quietly dying overnight.
 *
 * THE RULE THIS FILE OBEYS: an open item is a fact about a record, never a
 * judgement about a person. "This lead has no next action" is checkable and
 * fixable. "You did not work hard enough" is neither, and nothing here should
 * ever be able to produce it. Every item names a record and what is missing
 * from it, and the screen that shows them does not block the rep from ending
 * their route.
 *
 * SCOPE: only leads this route actually touched. A rep who knocks eleven doors
 * should not be handed the whole pipeline's unfinished business at 5pm, and
 * showing them work they did not do today is the fastest way to teach them to
 * skip the screen.
 */

export type OpenItemKind =
  /** Worked today, no follow-up date on it. It will not resurface by itself. */
  | 'no_next_action'
  /** Inspection opened at a door and never finished. */
  | 'inspection_incomplete'
  /** Someone agreed to an appointment and no date was recorded. */
  | 'appointment_without_date'
  /** Follow-up already due, or due by the end of tomorrow. */
  | 'due_soon'

export interface OpenItem {
  readonly kind: OpenItemKind
  readonly leadId: string
  readonly address: string
  /** What is missing, in the words a rep would use. */
  readonly detail: string
}

export const OPEN_ITEM_LABEL: Record<OpenItemKind, string> = {
  no_next_action: 'No next action',
  inspection_incomplete: 'Inspection not finished',
  appointment_without_date: 'Appointment with no date',
  due_soon: 'Due by tomorrow',
}

/**
 * Statuses where "no next action" is the correct, finished state.
 *
 * A rep who marks a door "not interested" has done the right thing and must not
 * be nagged about it. Counting these would make the open-items list mostly
 * noise, and a list that is mostly noise gets dismissed without reading - which
 * costs the items that did matter.
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  'not_interested',
  'do_not_knock',
  'disqualified',
])

export interface InspectionState {
  readonly id: string
  readonly status: 'in_progress' | 'complete'
}

export interface OpenItemInput {
  /** Leads this route recorded something against. */
  readonly leads: readonly ManagedLead[]
  readonly events: readonly DoorEvent[]
  /** Local inspections, so an unfinished one can be named. */
  readonly inspections?: readonly InspectionState[]
  /** ISO instant the route ended. Drives "due by tomorrow". */
  readonly now: string
}

/** End of the day after `now`, in the caller's local time. */
function endOfTomorrow(now: string): string {
  const d = new Date(now)
  if (!Number.isFinite(d.getTime())) return now
  d.setDate(d.getDate() + 1)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/**
 * Builds the unfinished list for one route.
 *
 * Deliberately returns at most ONE item per lead, in priority order. A lead
 * with an unfinished inspection AND no next action is one thing to go and fix,
 * not two, and listing it twice makes the count at the top of the screen wrong
 * in the direction that causes panic.
 */
export function openItems(input: OpenItemInput): OpenItem[] {
  const touched = new Set(input.events.map((e) => e.leadId))
  const byId = new Map(input.leads.map((l) => [l.id, l]))
  const inspections = new Map((input.inspections ?? []).map((i) => [i.id, i.status]))
  const tomorrow = endOfTomorrow(input.now)

  const items: OpenItem[] = []

  for (const leadId of touched) {
    const lead = byId.get(leadId)
    if (!lead) continue

    // Highest priority first, and only one item per lead.
    if (lead.inspectionId && inspections.get(lead.inspectionId) === 'in_progress') {
      items.push({
        kind: 'inspection_incomplete',
        leadId,
        address: lead.address,
        detail: 'Started at the door and not finished',
      })
      continue
    }

    if (lead.status === 'appointment' && lead.appointmentAt === undefined) {
      items.push({
        kind: 'appointment_without_date',
        leadId,
        address: lead.address,
        detail: 'Booked with no date on it',
      })
      continue
    }

    if (lead.nextActionAt === undefined && !SETTLED_STATUSES.has(lead.status)) {
      items.push({
        kind: 'no_next_action',
        leadId,
        address: lead.address,
        detail: 'Nothing scheduled, so it will not come back on its own',
      })
      continue
    }

    if (
      lead.nextActionAt !== undefined &&
      (isDue(lead, input.now) || lead.nextActionAt <= tomorrow)
    ) {
      items.push({
        kind: 'due_soon',
        leadId,
        address: lead.address,
        detail: isDue(lead, input.now) ? 'Already due' : 'Due by the end of tomorrow',
      })
    }
  }

  // Stable order so the same route produces the same list twice running.
  const rank: Record<OpenItemKind, number> = {
    inspection_incomplete: 0,
    appointment_without_date: 1,
    no_next_action: 2,
    due_soon: 3,
  }
  return items.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.address.localeCompare(b.address),
  )
}

export interface OpenItemGroup {
  readonly kind: OpenItemKind
  readonly label: string
  readonly items: readonly OpenItem[]
}

/** The same list, grouped for a screen. Empty groups are dropped. */
export function groupOpenItems(items: readonly OpenItem[]): OpenItemGroup[] {
  const order: OpenItemKind[] = [
    'inspection_incomplete',
    'appointment_without_date',
    'no_next_action',
    'due_soon',
  ]
  return order
    .map((kind) => ({
      kind,
      label: OPEN_ITEM_LABEL[kind],
      items: items.filter((i) => i.kind === kind),
    }))
    .filter((g) => g.items.length > 0)
}
