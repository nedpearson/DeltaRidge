import { describe, expect, it } from 'vitest'
import { bboxAround, expandBbox } from '@/features/leads/search-area'

describe('GPS-centered lead search geometry', () => {
  it('builds a bounding box around Baton Rouge for the chosen radius', () => {
    const bbox = bboxAround({ latitude: 30.4515, longitude: -91.1871 }, 5)
    expect(bbox[0]).toBeLessThan(-91.1871)
    expect(bbox[2]).toBeGreaterThan(-91.1871)
    expect(bbox[1]).toBeLessThan(30.4515)
    expect(bbox[3]).toBeGreaterThan(30.4515)
  })

  it('gets wider when the rep increases the search radius', () => {
    const small = bboxAround({ latitude: 30.4515, longitude: -91.1871 }, 3)
    const large = bboxAround({ latitude: 30.4515, longitude: -91.1871 }, 10)
    expect(large[2] - large[0]).toBeGreaterThan(small[2] - small[0])
    expect(large[3] - large[1]).toBeGreaterThan(small[3] - small[1])
  })

  it('expands the storm query beyond the property-search box', () => {
    const search = bboxAround({ latitude: 30.4515, longitude: -91.1871 }, 5)
    const storms = expandBbox(search, 3)
    expect(storms[0]).toBeLessThan(search[0])
    expect(storms[1]).toBeLessThan(search[1])
    expect(storms[2]).toBeGreaterThan(search[2])
    expect(storms[3]).toBeGreaterThan(search[3])
  })
})
