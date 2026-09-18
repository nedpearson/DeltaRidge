import { describe, expect, it } from 'vitest'
import { evaluateCompleteness } from '../../src/features/inspections/completeness'
import type { InspectionSnapshot, PhotoLike } from '../../src/features/inspections/completeness'
import { REQUIRED_RESIDENTIAL, requiredCategoriesFor } from '../../src/features/inspections/photo-categories'
import type { PhotoCategory } from '../../src/features/inspections/photo-categories'

function photo(category: PhotoCategory, overrides: Partial<PhotoLike> = {}): PhotoLike {
  return { id: `p-${category}-${Math.random().toString(36).slice(2, 7)}`, category, retakeRecommended: false, ...overrides }
}

/** A fully documented, sendable inspection. Each test degrades one thing. */
function goodInspection(overrides: Partial<InspectionSnapshot> = {}): InspectionSnapshot {
  return {
    customerFirstName: 'Dale',
    customerLastName: 'Boudreaux',
    customerPhone: '(225) 573-4442',
    addressLine1: '14235 Airline Hwy',
    roofMaterial: 'architectural_shingle',
    stories: 1,
    photos: REQUIRED_RESIDENTIAL.map((c) => photo(c)),
    observations: [],
    requiredCategories: REQUIRED_RESIDENTIAL,
    inspectorRecommendation: 'Full replacement, storm claim likely.',
    ...overrides,
  }
}

describe('evaluateCompleteness — blockers', () => {
  it('lets a fully documented inspection through', () => {
    const report = evaluateCompleteness(goodInspection())
    expect(report.blockers).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
    expect(report.canSend).toBe(true)
    expect(report.score).toBe(100)
  })

  it('blocks when no homeowner name is recorded', () => {
    const report = evaluateCompleteness(
      goodInspection({ customerFirstName: null, customerLastName: null, customerCompanyName: null }),
    )
    expect(report.canSend).toBe(false)
    expect(report.blockers.map((b) => b.code)).toContain('customer.name_missing')
  })

  it('accepts a company name in place of a personal name', () => {
    const report = evaluateCompleteness(
      goodInspection({ customerFirstName: null, customerLastName: null, customerCompanyName: 'Ascension Storage LLC' }),
    )
    expect(report.blockers).toHaveLength(0)
  })

  it('blocks when there is no way to contact anyone', () => {
    const report = evaluateCompleteness(goodInspection({ customerPhone: null, customerEmail: null }))
    expect(report.blockers.map((b) => b.code)).toContain('customer.contact_missing')
  })

  it('accepts email alone as contact', () => {
    const report = evaluateCompleteness(
      goodInspection({ customerPhone: null, customerEmail: 'dale@example.com' }),
    )
    expect(report.blockers).toHaveLength(0)
  })

  it('blocks an inspection with no usable photos', () => {
    const report = evaluateCompleteness(goodInspection({ photos: [], requiredCategories: [] }))
    expect(report.blockers.map((b) => b.code)).toContain('photos.none')
  })

  it('treats photos that all need retaking as no photos at all', () => {
    const report = evaluateCompleteness(
      goodInspection({
        photos: [photo('roof_overview', { retakeRecommended: true, qualityFlag: 'blurry' })],
        requiredCategories: [],
      }),
    )
    expect(report.blockers.map((b) => b.code)).toContain('photos.none')
  })
})

describe('evaluateCompleteness — the callback-prevention warnings', () => {
  it('flags a condition mentioned in notes with no supporting photo', () => {
    const report = evaluateCompleteness(
      goodInspection({
        observations: [
          { id: 'o1', finding: 'Pipe boot on the back right is cracked', severity: 'moderate', source: 'inspector' },
        ],
      }),
    )
    const codes = report.warnings.map((w) => w.code)
    expect(codes).toContain('evidence.missing.pipe_boot')
    // Still sendable: a warning informs, it does not block.
    expect(report.canSend).toBe(true)
  })

  it('clears that warning once the photo exists', () => {
    const report = evaluateCompleteness(
      goodInspection({
        photos: [...REQUIRED_RESIDENTIAL.map((c) => photo(c)), photo('pipe_boot')],
        observations: [
          { id: 'o1', finding: 'Pipe boot on the back right is cracked', severity: 'moderate', source: 'inspector' },
        ],
      }),
    )
    expect(report.warnings.map((w) => w.code)).not.toContain('evidence.missing.pipe_boot')
  })

  it('flags damage close-ups with no overview of that slope', () => {
    const photos = REQUIRED_RESIDENTIAL.filter((c) => c !== 'slope_rear').map((c) => photo(c))
    photos.push(photo('hail_impact', { area: 'rear' }))
    const report = evaluateCompleteness(goodInspection({ photos }))
    const codes = report.warnings.map((w) => w.code)
    expect(codes).toContain('context.missing_overview.slope_rear')
  })

  it('recognises "back" as the rear slope', () => {
    const photos = REQUIRED_RESIDENTIAL.filter((c) => c !== 'slope_rear').map((c) => photo(c))
    photos.push(photo('creasing', { area: 'Back Slope' }))
    const report = evaluateCompleteness(goodInspection({ photos }))
    expect(report.warnings.map((w) => w.code)).toContain('context.missing_overview.slope_rear')
  })

  it('names the specific photo that needs retaking, with the reason', () => {
    const photos = REQUIRED_RESIDENTIAL.map((c) => photo(c))
    photos.push(photo('pipe_boot', { id: 'blurry-1', retakeRecommended: true, qualityFlag: 'blurry' }))
    const report = evaluateCompleteness(goodInspection({ photos }))
    const issue = report.warnings.find((w) => w.code === 'quality.retake.blurry-1')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('blurry')
    expect(issue?.message).toContain('pipe boot')
  })

  it('refuses to let unconfirmed AI findings pass silently', () => {
    const report = evaluateCompleteness(
      goodInspection({
        observations: [
          { id: 'a1', finding: 'Possible hail impact, circular granule displacement', severity: 'requires_verification', source: 'ai' },
        ],
        photos: [...REQUIRED_RESIDENTIAL.map((c) => photo(c)), photo('hail_impact')],
      }),
    )
    expect(report.warnings.map((w) => w.code)).toContain('observations.unconfirmed_ai')
  })

  it('stops warning once the human confirms the AI finding', () => {
    const report = evaluateCompleteness(
      goodInspection({
        observations: [
          {
            id: 'a1', finding: 'Possible hail impact', severity: 'requires_verification',
            source: 'ai', confirmedAt: '2026-09-18T10:00:00Z',
          },
        ],
        photos: [...REQUIRED_RESIDENTIAL.map((c) => photo(c)), photo('hail_impact')],
      }),
    )
    expect(report.warnings.map((w) => w.code)).not.toContain('observations.unconfirmed_ai')
  })

  it('honours a deliberate waiver but not a silent gap', () => {
    const photos = REQUIRED_RESIDENTIAL.filter((c) => c !== 'gutter').map((c) => photo(c))
    const silent = evaluateCompleteness(goodInspection({ photos }))
    expect(silent.warnings.map((w) => w.code)).toContain('checklist.missing.gutter')

    const waivedReport = evaluateCompleteness(goodInspection({ photos, waivedCategories: ['gutter'] }))
    expect(waivedReport.warnings.map((w) => w.code)).not.toContain('checklist.missing.gutter')
  })
})

describe('evaluateCompleteness — the composite example from the brief', () => {
  it('reports all four real gaps at once', () => {
    const photos = REQUIRED_RESIDENTIAL.filter((c) => c !== 'slope_rear').map((c) => photo(c))
    photos.push(photo('hail_impact', { area: 'rear' }))
    photos.push(photo('pipe_boot', { id: 'pb-1', retakeRecommended: true, qualityFlag: 'blurry' }))

    const report = evaluateCompleteness(
      goodInspection({
        photos,
        customerPhone: null,
        customerEmail: 'dale@example.com',
        observations: [
          { id: 'o1', finding: 'Gutters have dents on the north side', severity: 'minor', source: 'voice' },
        ],
      }),
    )
    const codes = report.warnings.map((w) => w.code)
    expect(codes).toContain('context.missing_overview.slope_rear') // missing rear-slope overview
    expect(codes).toContain('quality.retake.pb-1')                 // blurry pipe-boot image
    expect(codes).toContain('checklist.missing.slope_rear')         // required category outstanding
    // Gutter damage was dictated AND a gutter photo exists, so no evidence gap.
    expect(codes).not.toContain('evidence.missing.gutter')
    expect(report.score).toBeLessThan(100)
  })
})

describe('advisories and scoring', () => {
  it('nudges on unknown roof material without blocking', () => {
    const report = evaluateCompleteness(goodInspection({ roofMaterial: 'unknown' }))
    expect(report.advisories.map((a) => a.code)).toContain('roof.material_unknown')
    expect(report.canSend).toBe(true)
  })

  it('never returns a score outside 0-100', () => {
    const wrecked = evaluateCompleteness({
      roofMaterial: 'unknown',
      photos: [],
      observations: Array.from({ length: 12 }, (_, i) => ({
        id: `o${i}`, finding: 'gutter chimney skylight valley ridge siding attic flashing vent downspout fascia soffit',
        severity: 'moderate', source: 'ai' as const,
      })),
      requiredCategories: REQUIRED_RESIDENTIAL,
    })
    expect(wrecked.score).toBeGreaterThanOrEqual(0)
    expect(wrecked.score).toBeLessThanOrEqual(100)
    expect(wrecked.canSend).toBe(false)
  })
})

describe('requiredCategoriesFor', () => {
  it('drops slope overviews for commercial flat roofs and adds access', () => {
    const cats = requiredCategoriesFor('commercial')
    expect(cats.some((c) => c.startsWith('slope_'))).toBe(false)
    expect(cats).toContain('access_concern')
  })

  it('adds side slopes for a two-storey residential property', () => {
    const cats = requiredCategoriesFor('residential', 2)
    expect(cats).toContain('slope_left')
    expect(cats).toContain('slope_right')
  })

  it('keeps the short list for a single-storey house', () => {
    expect(requiredCategoriesFor('residential', 1)).toEqual(REQUIRED_RESIDENTIAL)
  })
})
