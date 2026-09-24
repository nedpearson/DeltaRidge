export type ImageryView = 'ortho' | 'north' | 'east' | 'south' | 'west'

export interface ImageryCapture {
  readonly provider: 'eagleview'
  readonly captureId: string
  readonly imageUrn: string
  readonly capturedFrom: string | null
  readonly capturedUntil: string | null
  readonly publishedAt: string | null
  readonly gsdMetres: number | null
  readonly composite: boolean
  readonly disaster: boolean
  readonly view: ImageryView
}

export interface ImagerySearchResult {
  readonly configured: boolean
  readonly captures: readonly ImageryCapture[]
  readonly nextCaptureToken: string | null
  readonly message: string | null
}

export type FreshnessBand =
  | 'under_24_hours'
  | 'one_to_seven_days'
  | 'eight_to_thirty_days'
  | 'thirty_one_to_ninety_days'
  | 'older'
  | 'unknown'

export interface StormPair {
  readonly before: ImageryCapture | null
  readonly after: ImageryCapture | null
}

export interface ImageryProvider {
  readonly id: ImageryCapture['provider']
  searchCaptures(input: {
    latitude: number
    longitude: number
    from?: string
    until?: string
    nextCaptureToken?: string
  }): Promise<ImagerySearchResult>
  image(capture: ImageryCapture, input: {
    latitude: number
    longitude: number
    radiusMetres?: number
  }): Promise<Blob>
}
