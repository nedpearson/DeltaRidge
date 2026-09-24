import { getSupabase } from '@/lib/supabase'
import type { ImageryCapture, ImageryProvider, ImagerySearchResult } from './types'

interface SearchPayload extends ImagerySearchResult {
  readonly captures: ImageryCapture[]
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return 'EagleView could not be reached.'
}

export class EagleViewImageryProvider implements ImageryProvider {
  readonly id = 'eagleview' as const

  async searchCaptures(input: {
    latitude: number
    longitude: number
    from?: string
    until?: string
    nextCaptureToken?: string
  }): Promise<ImagerySearchResult> {
    const supabase = getSupabase()
    if (supabase === null) {
      return { configured: false, captures: [], nextCaptureToken: null, message: 'Sign in to search EagleView.' }
    }
    const { data, error } = await supabase.functions.invoke<SearchPayload>('eagleview-imagery', {
      body: { action: 'search', ...input },
    })
    if (error !== null) {
      return { configured: true, captures: [], nextCaptureToken: null, message: messageOf(error) }
    }
    return data ?? { configured: true, captures: [], nextCaptureToken: null, message: 'EagleView returned no response.' }
  }

  async image(
    capture: ImageryCapture,
    input: { latitude: number; longitude: number; radiusMetres?: number },
  ): Promise<Blob> {
    const supabase = getSupabase()
    if (supabase === null) throw new Error('Sign in to open EagleView imagery.')
    const { data, error } = await supabase.functions.invoke<Blob>('eagleview-imagery', {
      body: {
        action: 'image',
        imageUrn: capture.imageUrn,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMetres: input.radiusMetres ?? 35,
      },
    })
    if (error !== null) throw new Error(messageOf(error))
    if (!(data instanceof Blob)) throw new Error('EagleView returned an unreadable image.')
    return data
  }
}
