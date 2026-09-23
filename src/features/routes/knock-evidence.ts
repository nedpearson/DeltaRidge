import { currentPosition } from '@/lib/image'
import type { KnockVerificationRecord } from '@/features/leads/pipeline'
import { classifyKnock } from './verification'

/**
 * Asks the phone where it is, once, at the moment a knock is recorded.
 *
 * Deliberately short-fused. A rep tapping an outcome is standing in a driveway
 * with the next door in mind; making them wait on a satellite fix would be a
 * worse product and would eventually train them to record knocks from the car.
 * A timeout produces `gps_unavailable`, which is an honest answer, and the
 * knock saves either way.
 *
 * This NEVER blocks or alters the outcome being recorded. Evidence about a
 * knock is worth having; it is not worth losing the knock over.
 */

export const EVIDENCE_TIMEOUT_MS = 4000

export async function evidenceFor(
  property: { latitude: number; longitude: number } | null | undefined,
  timeoutMs = EVIDENCE_TIMEOUT_MS,
): Promise<KnockVerificationRecord> {
  let fix: { latitude: number; longitude: number; accuracyMeters?: number } | null = null
  try {
    const pos = await currentPosition(timeoutMs)
    if (pos) {
      fix = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        ...(Number.isFinite(pos.coords.accuracy) ? { accuracyMeters: pos.coords.accuracy } : {}),
      }
    }
  } catch {
    // Treated as no fix. A thrown geolocation error and a refused one mean the
    // same thing to the record: nothing is known about where the phone was.
    fix = null
  }

  const result = classifyKnock(fix, property)
  return {
    verification: result.verification,
    ...(result.distanceMeters !== null ? { distanceMeters: result.distanceMeters } : {}),
    ...(result.accuracyMeters !== null ? { accuracyMeters: result.accuracyMeters } : {}),
  }
}
