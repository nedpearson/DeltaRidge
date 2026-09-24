import { describe, expect, it } from 'vitest'
import {
  ageDays,
  freshnessBand,
  pairAroundStorm,
  rankCaptures,
  resolutionLabel,
  withinDays,
} from '@/features/imagery/selection'
import type { ImageryCapture } from '@/features/imagery/types'

const capture = (over: Partial<ImageryCapture> = {}): ImageryCapture => ({
  provider: 'eagleview',
  captureId: 'capture-1',
  imageUrn: 'urn:eagleview.com:test:1',
  capturedFrom: '2026-09-20T00:00:00Z',
  capturedUntil: '2026-09-20T00:00:00Z',
  publishedAt: '2026-09-21T00:00:00Z',
  gsdMetres: 0.0254,
  composite: false,
  disaster: false,
  view: 'ortho',
  ...over,
})

const NOW = Date.parse('2026-09-24T12:00:00Z')

describe('imagery freshness', () => {
  it('uses the end of a capture window and never invents an age without a date', () => {
    expect(ageDays(capture(), NOW)).toBe(4)
    expect(ageDays(capture({ capturedFrom: null, capturedUntil: null }), NOW)).toBeNull()
  })

  it('keeps the requested freshness boundary inclusive', () => {
    const seven = capture({ capturedFrom: '2026-09-17T12:00:00Z', capturedUntil: '2026-09-17T12:00:00Z' })
    expect(freshnessBand(seven, NOW)).toBe('one_to_seven_days')
    expect(withinDays([seven], 7, NOW)).toHaveLength(1)
  })
})

describe('selection', () => {
  it('ranks newest before finer older imagery', () => {
    const olderFine = capture({ captureId: 'old', imageUrn: 'old', capturedUntil: '2026-09-01', gsdMetres: 0.01 })
    const newerCoarse = capture({ captureId: 'new', imageUrn: 'new', capturedUntil: '2026-09-23', gsdMetres: 0.08 })
    expect(rankCaptures([olderFine, newerCoarse]).map((row) => row.captureId)).toEqual(['new', 'old'])
  })

  it('selects the nearest real capture either side of the storm', () => {
    const beforeFar = capture({ captureId: 'before-far', imageUrn: '1', capturedUntil: '2026-08-01' })
    const beforeNear = capture({ captureId: 'before-near', imageUrn: '2', capturedUntil: '2026-09-17' })
    const afterNear = capture({ captureId: 'after-near', imageUrn: '3', capturedUntil: '2026-09-19' })
    const afterFar = capture({ captureId: 'after-far', imageUrn: '4', capturedUntil: '2026-09-23' })
    const pair = pairAroundStorm([afterFar, beforeFar, afterNear, beforeNear], '2026-09-18T12:00:00Z')
    expect(pair.before?.captureId).toBe('before-near')
    expect(pair.after?.captureId).toBe('after-near')
  })
})

describe('resolution label', () => {
  it('converts provider metres per pixel to inches per pixel', () => {
    expect(resolutionLabel(0.0254)).toBe('1.0-inch GSD')
    expect(resolutionLabel(null)).toMatch(/not supplied/i)
  })
})
