/**
 * Inspection completeness engine.
 *
 * This is the feature that pays for the product: catch the missing rear-slope
 * overview while the rep is still standing in the driveway, not when the office
 * calls them back two days later.
 *
 * It is deliberately pure — no network, no database, no React. Everything it
 * needs is passed in, which makes it exhaustively testable and lets it run
 * offline, which is exactly when it matters most.
 *
 * Three classes of issue, and the distinction is important:
 *   - blocker:  the handoff should not be sent. Missing customer identity.
 *   - warning:  the office will probably have to call. A referenced condition
 *               with no supporting photo. This is the money category.
 *   - advisory: worth a glance, not worth blocking.
 */

import type { PhotoCategory } from './photo-categories'
import { CATEGORY_LABELS, DAMAGE_CATEGORIES, SLOPE_OVERVIEW_FOR } from './photo-categories'

export type IssueSeverity = 'blocker' | 'warning' | 'advisory'

export interface CompletenessIssue {
  /** Stable machine id, so the UI can route "Fix Now" without string matching. */
  code: string
  severity: IssueSeverity
  /**
   * Plain-language message addressed to the rep. Written the way a good foreman
   * would say it: specific, not scolding.
   */
  message: string
  /** Where Fix Now should take them. */
  fix?:
    | { kind: 'camera'; category: PhotoCategory }
    | { kind: 'field'; field: string }
    | { kind: 'photo'; photoId: string }
}

export interface PhotoLike {
  id: string
  category: PhotoCategory | null
  area?: string | null
  retakeRecommended: boolean
  qualityFlag?: string | null
  deletedAt?: string | null
}

export interface ObservationLike {
  id: string
  component?: string | null
  area?: string | null
  finding: string
  severity: string
  confirmedAt?: string | null
  source: 'inspector' | 'voice' | 'ai'
}

export interface InspectionSnapshot {
  customerFirstName?: string | null
  customerLastName?: string | null
  customerCompanyName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  addressLine1?: string | null
  roofMaterial: string
  stories?: number | null
  photos: PhotoLike[]
  observations: ObservationLike[]
  requiredCategories: PhotoCategory[]
  /** Categories the rep explicitly waived, with a reason recorded. */
  waivedCategories?: PhotoCategory[]
  inspectorRecommendation?: string | null
}

export interface CompletenessReport {
  issues: CompletenessIssue[]
  blockers: CompletenessIssue[]
  warnings: CompletenessIssue[]
  advisories: CompletenessIssue[]
  /** True when nothing blocks the handoff. Warnings do not block. */
  canSend: boolean
  /** 0-100. Presented as "documentation completeness", never as roof condition. */
  score: number
}

/** Photos that actually count as documentation: present, usable, not deleted. */
function usablePhotos(photos: PhotoLike[]): PhotoLike[] {
  return photos.filter((p) => !p.deletedAt && !p.retakeRecommended)
}

function hasCategory(photos: PhotoLike[], category: PhotoCategory): boolean {
  return usablePhotos(photos).some((p) => p.category === category)
}

/**
 * Detects the single most valuable class of gap: the rep wrote down a condition
 * but never photographed it. The office cannot price what it cannot see.
 *
 * Matching is keyword-based over the observation text and component field. It is
 * deliberately generous about false positives — an extra prompt costs the rep one
 * tap; a missed gutter photo costs a callback and a second trip.
 */
const CONDITION_PHOTO_REQUIREMENTS: Array<{
  keywords: string[]
  category: PhotoCategory
  noun: string
}> = [
  { keywords: ['pipe boot', 'pipeboot', 'boot'], category: 'pipe_boot', noun: 'pipe boot' },
  { keywords: ['gutter'], category: 'gutter', noun: 'gutter' },
  { keywords: ['downspout'], category: 'downspout', noun: 'downspout' },
  { keywords: ['fascia'], category: 'fascia', noun: 'fascia' },
  { keywords: ['soffit'], category: 'soffit', noun: 'soffit' },
  { keywords: ['chimney'], category: 'chimney', noun: 'chimney' },
  { keywords: ['skylight'], category: 'skylight', noun: 'skylight' },
  { keywords: ['flashing'], category: 'flashing', noun: 'flashing' },
  { keywords: ['vent'], category: 'vent', noun: 'vent' },
  { keywords: ['valley'], category: 'valley', noun: 'valley' },
  { keywords: ['ridge'], category: 'ridge', noun: 'ridge' },
  { keywords: ['siding'], category: 'siding', noun: 'siding' },
  { keywords: ['interior', 'ceiling stain', 'water stain'], category: 'interior_water_damage', noun: 'interior water damage' },
  { keywords: ['attic', 'decking'], category: 'attic', noun: 'attic or decking' },
]

function observationText(o: ObservationLike): string {
  return `${o.finding} ${o.component ?? ''} ${o.area ?? ''}`.toLowerCase()
}

export function evaluateCompleteness(snapshot: InspectionSnapshot): CompletenessReport {
  const issues: CompletenessIssue[] = []
  const waived = new Set(snapshot.waivedCategories ?? [])
  const photos = snapshot.photos

  // --- Blockers: the office literally cannot proceed without these. ---
  const hasName = Boolean(
    snapshot.customerCompanyName ?? (snapshot.customerFirstName ?? snapshot.customerLastName),
  )
  if (!hasName) {
    issues.push({
      code: 'customer.name_missing',
      severity: 'blocker',
      message: 'No homeowner name on this inspection. The office cannot open a job without one.',
      fix: { kind: 'field', field: 'customerName' },
    })
  }

  if (!snapshot.customerPhone && !snapshot.customerEmail) {
    issues.push({
      code: 'customer.contact_missing',
      severity: 'blocker',
      message: 'No phone number or email. Nobody can follow up on this inspection.',
      fix: { kind: 'field', field: 'customerPhone' },
    })
  }

  if (!snapshot.addressLine1) {
    issues.push({
      code: 'property.address_missing',
      severity: 'blocker',
      message: 'No property address recorded.',
      fix: { kind: 'field', field: 'addressLine1' },
    })
  }

  if (usablePhotos(photos).length === 0) {
    issues.push({
      code: 'photos.none',
      severity: 'blocker',
      message: 'No usable photos yet. An inspection with no photographs is not a document the office can price.',
      fix: { kind: 'camera', category: 'roof_overview' },
    })
  }

  // --- Warnings: required checklist categories still outstanding. ---
  for (const category of snapshot.requiredCategories) {
    if (waived.has(category)) continue
    if (!hasCategory(photos, category)) {
      issues.push({
        code: `checklist.missing.${category}`,
        severity: 'warning',
        message: `Missing a ${CATEGORY_LABELS[category]} photo.`,
        fix: { kind: 'camera', category },
      })
    }
  }

  // --- Warnings: damage documented on a slope with no overview of that slope. ---
  // An office reviewer needs context: a close-up of hail means little without a
  // wide shot placing it on the roof.
  const damagePhotos = usablePhotos(photos).filter(
    (p) => p.category !== null && DAMAGE_CATEGORIES.includes(p.category),
  )
  const slopesWithDamage = new Set(
    damagePhotos.map((p) => (p.area ?? '').toLowerCase().trim()).filter((a) => a.length > 0),
  )
  for (const slope of slopesWithDamage) {
    const overview = SLOPE_OVERVIEW_FOR[slope]
    if (overview && !hasCategory(photos, overview)) {
      issues.push({
        code: `context.missing_overview.${overview}`,
        severity: 'warning',
        message:
          `You documented damage on the ${slope} slope but there is no overview photo of it. ` +
          `The office needs the wide shot to place the close-ups.`,
        fix: { kind: 'camera', category: overview },
      })
    }
  }

  // --- Warnings: a written observation with no supporting photograph. ---
  for (const requirement of CONDITION_PHOTO_REQUIREMENTS) {
    const mentioned = snapshot.observations.some((o) =>
      requirement.keywords.some((k) => observationText(o).includes(k)),
    )
    if (mentioned && !hasCategory(photos, requirement.category)) {
      issues.push({
        code: `evidence.missing.${requirement.category}`,
        severity: 'warning',
        message:
          `Your notes mention the ${requirement.noun} but no ${requirement.noun} photo is attached. ` +
          `Grab one before you leave.`,
        fix: { kind: 'camera', category: requirement.category },
      })
    }
  }

  // --- Warnings: photos flagged for retake are still outstanding. ---
  const needingRetake = photos.filter((p) => p.retakeRecommended && !p.deletedAt)
  for (const photo of needingRetake) {
    const label = photo.category ? CATEGORY_LABELS[photo.category] : 'photo'
    const why = photo.qualityFlag ? ` (${photo.qualityFlag})` : ''
    issues.push({
      code: `quality.retake.${photo.id}`,
      severity: 'warning',
      message: `The ${label} photo needs retaking${why}.`,
      fix: photo.category ? { kind: 'camera', category: photo.category } : { kind: 'photo', photoId: photo.id },
    })
  }

  // --- Warnings: AI-proposed observations nobody has confirmed. ---
  // An unconfirmed AI finding must never reach an office document as though a
  // human stood behind it.
  const unconfirmedAi = snapshot.observations.filter((o) => o.source === 'ai' && !o.confirmedAt)
  if (unconfirmedAi.length > 0) {
    issues.push({
      code: 'observations.unconfirmed_ai',
      severity: 'warning',
      message:
        `${unconfirmedAi.length} AI-suggested ${unconfirmedAi.length === 1 ? 'observation has' : 'observations have'} ` +
        `not been confirmed. Accept, edit, or reject each one so the report reflects what you actually saw.`,
      fix: { kind: 'field', field: 'observations' },
    })
  }

  // --- Advisories. ---
  if (snapshot.roofMaterial === 'unknown') {
    issues.push({
      code: 'roof.material_unknown',
      severity: 'advisory',
      message: 'Roof material is still "unknown". It affects pricing.',
      fix: { kind: 'field', field: 'roofMaterial' },
    })
  }

  if (snapshot.stories === null || snapshot.stories === undefined) {
    issues.push({
      code: 'roof.stories_unknown',
      severity: 'advisory',
      message: 'Number of stories not recorded. It affects the labour estimate.',
      fix: { kind: 'field', field: 'stories' },
    })
  }

  if (!snapshot.inspectorRecommendation) {
    issues.push({
      code: 'recommendation.missing',
      severity: 'advisory',
      message: 'No recommendation recorded. One line saves the office a phone call.',
      fix: { kind: 'field', field: 'inspectorRecommendation' },
    })
  }

  const blockers = issues.filter((i) => i.severity === 'blocker')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const advisories = issues.filter((i) => i.severity === 'advisory')

  return {
    issues,
    blockers,
    warnings,
    advisories,
    canSend: blockers.length === 0,
    score: computeScore(blockers.length, warnings.length, advisories.length),
  }
}

/**
 * Documentation completeness, not roof condition. Weighted so blockers dominate
 * and advisories barely register. Floored at 0 and capped at 100.
 */
function computeScore(blockers: number, warnings: number, advisories: number): number {
  const penalty = blockers * 25 + warnings * 6 + advisories * 2
  return Math.max(0, Math.min(100, 100 - penalty))
}
