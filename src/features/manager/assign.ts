import { findByAddress, promote, saveLead } from '@/features/leads/lead-store'
import type { ScoredLead } from '@/features/leads/scoring'
import { getRemoteId, setRemoteIdScope } from '@/lib/sync-store'
import { pushLead } from '@/lib/sync/leads'
import { assignLead } from './read'

/**
 * Handing out a door that only exists on this phone.
 *
 * The screen used to say "sync it first and then you can assign it", which is
 * true and useless: the manager is looking at the door they want to hand over,
 * and telling them to go and do something else first is how a feature gets
 * ignored. The door is promoted, pushed, and assigned in one action.
 *
 * Promotion creates the lead with status `new`, which the push maps to
 * `target`. That matters: assigning a door is not knocking it, and the office
 * record must not imply somebody has been there.
 */

export interface AssignOutcome {
  ok: boolean
  error: string | null
}

async function ensureOnServer(
  door: ScoredLead,
  orgId: string,
  userId: string,
): Promise<{ remoteId: string | null; error: string | null }> {
  // Every mapping read or written below belongs to this organisation.
  setRemoteIdScope(orgId)

  let lead = await findByAddress(door.addressKey)
  if (!lead) {
    lead = promote(door, new Date().toISOString())
    await saveLead(lead)
  }

  const existing = await getRemoteId('lead', lead.id)
  if (existing) return { remoteId: existing, error: null }

  try {
    return { remoteId: await pushLead(lead.id, orgId, userId), error: null }
  } catch (err) {
    return { remoteId: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function assignDoorTo(input: {
  door: ScoredLead
  orgId: string
  assignTo: string
  assignedBy: string
  reason: string
}): Promise<AssignOutcome> {
  const { remoteId, error } = await ensureOnServer(input.door, input.orgId, input.assignedBy)
  if (!remoteId) {
    return {
      ok: false,
      // Named rather than swallowed. The usual cause is being offline, and a
      // manager who is told that will try again from the office.
      error: error ?? 'This door could not be sent to the server, so it cannot be handed over yet.',
    }
  }

  const result = await assignLead({
    orgId: input.orgId,
    leadRemoteId: remoteId,
    assignTo: input.assignTo,
    assignedBy: input.assignedBy,
    // Frozen here, from the run that produced this door. Never read live again.
    score: input.door.score,
    reason: input.reason,
  })

  return { ok: result.error === null, error: result.error }
}
