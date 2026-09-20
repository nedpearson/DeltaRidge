import { describe, expect, it } from 'vitest'
import { costsDrifted, latestVersion, type SavedEstimate, type SavedVersion } from '@/features/estimating/store'
import { DEFAULT_MARGINS, type CostSheet } from '@/features/estimating/store'

const PRICED_COSTS: CostSheet = {
  shingle_sq: 120, underlayment_sq: 18, install_sq: 95, tear_off_sq: 45, disposal_job: 650,
}

function version(overrides: Partial<SavedVersion> = {}): SavedVersion {
  return {
    versionNumber: 1,
    createdAt: '2026-03-14T10:00:00Z',
    geometry: { areaSqFt: '3200' },
    costs: PRICED_COSTS,
    margins: DEFAULT_MARGINS,
    directCostCents: 1_032_500,
    overheadCents: 123_900,
    jobCostCents: 1_156_400,
    sellPriceCents: 2_141_500,
    gapCount: 0,
    ...overrides,
  }
}

function estimate(versions: SavedVersion[]): SavedEstimate {
  return {
    id: 'e1',
    inspectionId: 'i1',
    label: '19474 Perkins E Rd',
    createdAt: versions[0]?.createdAt ?? '2026-03-14T10:00:00Z',
    updatedAt: versions[versions.length - 1]?.createdAt ?? '2026-03-14T10:00:00Z',
    versions,
  }
}

describe('a saved version keeps the costs it was priced against', () => {
  it('stores the cost sheet, not a reference to it', () => {
    const v = version()
    expect(v.costs.shingle_sq).toBe(120)
    // The live sheet moving must not touch the saved one.
    const live: CostSheet = { ...PRICED_COSTS, shingle_sq: 141 }
    expect(v.costs.shingle_sq).toBe(120)
    expect(live.shingle_sq).toBe(141)
  })

  it('notices when a cost it used has since moved', () => {
    expect(costsDrifted(version(), { ...PRICED_COSTS, shingle_sq: 141 })).toBe(true)
  })

  it('does not warn when nothing it used has changed', () => {
    expect(costsDrifted(version(), PRICED_COSTS)).toBe(false)
  })

  /**
   * A cost the roof never needed is not a reason to tell the rep their saved
   * price is stale. Only the keys the version actually priced are compared.
   */
  it('ignores a change to a cost the estimate never used', () => {
    const untouched = { ...PRICED_COSTS, valley_lf: 3.4 }
    expect(costsDrifted(version(), untouched)).toBe(false)
  })

  it('treats a cost being removed as drift', () => {
    const removed: CostSheet = { ...PRICED_COSTS }
    delete removed.shingle_sq
    expect(costsDrifted(version(), removed)).toBe(true)
  })
})

describe('versions are append-only', () => {
  it('returns the newest version', () => {
    const e = estimate([
      version(),
      version({ versionNumber: 2, createdAt: '2026-09-20T10:00:00Z', sellPriceCents: 2_300_000 }),
    ])
    expect(latestVersion(e)?.versionNumber).toBe(2)
    expect(latestVersion(e)?.sellPriceCents).toBe(2_300_000)
  })

  it('keeps the earlier price intact beside the new one', () => {
    const e = estimate([
      version(),
      version({ versionNumber: 2, sellPriceCents: 2_300_000 }),
    ])
    expect(e.versions[0]?.sellPriceCents).toBe(2_141_500)
    expect(e.versions).toHaveLength(2)
  })

  it('handles an estimate with no versions rather than throwing', () => {
    expect(latestVersion(estimate([]))).toBeNull()
  })
})
