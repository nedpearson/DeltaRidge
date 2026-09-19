import { evaluateCompleteness, type CompletenessReport } from '@/features/inspections/completeness'
import { CATEGORY_LABELS, type PhotoCategory } from '@/features/inspections/photo-categories'
import type { LocalInspection, LocalObservation, LocalPhoto, LocalVoiceNote } from '@/lib/db'

/**
 * The office package.
 *
 * This is the product's payoff: the thing that means the office never has to
 * ring the rep and ask "which photo is the damage?". Two rules shape it.
 *
 * 1. It is a FROZEN SNAPSHOT. The payload is stored as jsonb on the handoff row
 *    and is never recomputed. If the rep edits the inspection afterwards, the
 *    office can still read exactly what it was sent — which matters when the
 *    package ends up attached to an insurance claim.
 *
 * 2. PROVENANCE IS PRESERVED, not flattened. Every claim carries who said it:
 *    the rep observed it, the homeowner stated it, or AI proposed it and nobody
 *    has confirmed it yet. An unconfirmed AI suggestion is marked as such in the
 *    payload rather than being quietly promoted into a finding. Overstating a
 *    roof inspection is a liability, not a UX nit.
 */

export interface HandoffPhoto {
  clientId: string
  category: PhotoCategory | null
  categoryLabel: string
  area: string | null
  caption: string | null
  capturedAt: string
  qualityFlag: string | null
  retakeRecommended: boolean
}

export interface HandoffObservation {
  clientId: string
  finding: string
  area: string | null
  component: string | null
  severity: LocalObservation['severity']
  /** inspector | voice | ai — the office needs to know which. */
  source: LocalObservation['source']
  confirmedByRep: boolean
}

export interface HandoffPackage {
  packageVersion: 1
  inspectionClientId: string
  generatedAt: string
  customer: {
    name: string | null
    companyName: string | null
    phone: string | null
    email: string | null
  }
  property: {
    addressLine1: string | null
    city: string | null
    parish: string | null
    postalCode: string | null
    propertyType: LocalInspection['propertyType']
    stories: number | null
    roofMaterial: string
    latitude: number | null
    longitude: number | null
  }
  /** Explicitly namespaced: these are the homeowner's words, not findings. */
  homeownerStated: {
    roofAgeYears: number | null
    insurer: string | null
  }
  inspection: {
    startedAt: string
    completedAt: string | null
    inspectorRecommendation: string | null
  }
  observations: HandoffObservation[]
  photos: HandoffPhoto[]
  photoSummary: {
    usable: number
    flaggedForRetake: number
    categoriesCovered: string[]
  }
  voiceNotes: Array<{
    clientId: string
    recordedAt: string
    durationSeconds: number
    /** Null until transcription exists. The audio is still attached. */
    transcript: string | null
  }>
  /** What was missing at the moment of sending, and what the rep waived. */
  validation: {
    score: number
    canSend: boolean
    blockers: Array<{ code: string; message: string }>
    warnings: Array<{ code: string; message: string }>
    overriddenIssueCodes: string[]
    overrideNote: string | null
  }
}

function customerName(i: LocalInspection): string | null {
  const n = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ').trim()
  return n || null
}

export interface HandoffInput {
  inspection: LocalInspection
  photos: LocalPhoto[]
  observations: LocalObservation[]
  voiceNotes: LocalVoiceNote[]
  requiredCategories: PhotoCategory[]
  generatedAt?: string
}

export function buildHandoffPackage(input: HandoffInput): { payload: HandoffPackage; report: CompletenessReport } {
  const { inspection: i, photos, observations, voiceNotes, requiredCategories } = input

  const report = evaluateCompleteness({
    roofMaterial: i.roofMaterial,
    requiredCategories,
    photos: photos.map((p) => ({
      id: p.id,
      category: p.category,
      area: p.area ?? null,
      retakeRecommended: p.retakeRecommended,
      qualityFlag: p.qualityFlag ?? null,
    })),
    observations: observations.map((o) => ({
      id: o.id,
      finding: o.finding,
      severity: o.severity,
      source: o.source,
      area: o.area ?? null,
      component: o.component ?? null,
      confirmedAt: o.confirmedAt ?? null,
    })),
    customerFirstName: i.customerFirstName ?? null,
    customerLastName: i.customerLastName ?? null,
    customerCompanyName: i.customerCompanyName ?? null,
    customerPhone: i.customerPhone ?? null,
    customerEmail: i.customerEmail ?? null,
    addressLine1: i.addressLine1 ?? null,
    stories: i.stories ?? null,
    inspectorRecommendation: i.inspectorRecommendation ?? null,
    ...(i.waivedCategories ? { waivedCategories: i.waivedCategories } : {}),
  })

  const usable = photos.filter((p) => !p.retakeRecommended)
  const sortedPhotos = [...photos].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))

  const payload: HandoffPackage = {
    packageVersion: 1,
    inspectionClientId: i.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    customer: {
      name: customerName(i),
      companyName: i.customerCompanyName ?? null,
      phone: i.customerPhone ?? null,
      email: i.customerEmail ?? null,
    },
    property: {
      addressLine1: i.addressLine1 ?? null,
      city: i.city ?? null,
      parish: i.parish ?? null,
      postalCode: i.postalCode ?? null,
      propertyType: i.propertyType,
      stories: i.stories ?? null,
      roofMaterial: i.roofMaterial,
      latitude: i.latitude ?? null,
      longitude: i.longitude ?? null,
    },
    homeownerStated: {
      roofAgeYears: i.homeownerStatedRoofAgeYears ?? null,
      insurer: i.homeownerStatedInsurer ?? null,
    },
    inspection: {
      startedAt: i.createdAt,
      completedAt: i.completedAt ?? null,
      inspectorRecommendation: i.inspectorRecommendation ?? null,
    },
    observations: [...observations]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((o) => ({
        clientId: o.id,
        finding: o.finding,
        area: o.area ?? null,
        component: o.component ?? null,
        severity: o.severity,
        source: o.source,
        confirmedByRep: Boolean(o.confirmedAt),
      })),
    photos: sortedPhotos.map((p) => ({
      clientId: p.id,
      category: p.category,
      categoryLabel: p.category ? CATEGORY_LABELS[p.category] : 'Uncategorised',
      area: p.area ?? null,
      caption: p.caption ?? null,
      capturedAt: p.capturedAt,
      qualityFlag: p.qualityFlag ?? null,
      retakeRecommended: p.retakeRecommended,
    })),
    photoSummary: {
      usable: usable.length,
      flaggedForRetake: photos.length - usable.length,
      categoriesCovered: [...new Set(usable.map((p) => p.category).filter((c): c is PhotoCategory => c !== null))]
        .map((c) => CATEGORY_LABELS[c])
        .sort(),
    },
    voiceNotes: [...voiceNotes]
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .map((v) => ({
        clientId: v.id,
        recordedAt: v.recordedAt,
        durationSeconds: v.durationSeconds,
        transcript: v.transcript ?? null,
      })),
    validation: {
      score: report.score,
      canSend: report.canSend,
      blockers: report.blockers.map((b) => ({ code: b.code, message: b.message })),
      warnings: report.warnings.map((w) => ({ code: w.code, message: w.message })),
      overriddenIssueCodes: i.overriddenIssueCodes ?? [],
      overrideNote: i.overrideNote ?? null,
    },
  }

  return { payload, report }
}

/**
 * Deterministic JSON: object keys sorted at every level so two structurally
 * identical packages produce byte-identical text, and therefore the same hash.
 * Without this the hash would depend on key insertion order and every resend
 * would look like a change.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}

/**
 * FNV-1a, 32 bits, run twice with different offsets to give 64 bits of hex.
 *
 * Deliberately not SubtleCrypto: that is async and unavailable on insecure
 * origins, and this runs on a phone that may be on http on a job-site hotspot.
 * The job is change detection for a resend, not security — nothing trusts this
 * hash to be unforgeable.
 */
export function payloadHash(payload: unknown): string {
  const text = stableStringify(payload)
  const round = (offset: number): string => {
    let h = offset
    for (let idx = 0; idx < text.length; idx += 1) {
      h ^= text.charCodeAt(idx)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return `${round(0x811c9dc5)}${round(0x7fffffff)}`
}

/**
 * The hash ignores `generatedAt` on purpose: re-sending the same inspection an
 * hour later is a no-op the office should not see as a change, and a timestamp
 * in the hash would make every resend look different.
 */
export function packageFingerprint(payload: HandoffPackage): string {
  const comparable: Record<string, unknown> = { ...payload }
  delete comparable['generatedAt']
  return payloadHash(comparable)
}
