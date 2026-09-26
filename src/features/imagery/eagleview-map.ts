import { getSupabase } from '@/lib/supabase'

export interface EagleViewMapConfig {
  configured: boolean
  tileSize: number
  minZoom: number
  maxZoom: number
  provider: 'eagleview'
  message: string | null
}

export async function eagleViewMapConfig(): Promise<EagleViewMapConfig> {
  const supabase = getSupabase()
  if (!supabase) {
    return {
      configured: false,
      tileSize: 256,
      minZoom: 1,
      maxZoom: 22,
      provider: 'eagleview',
      message: 'Sign in to use EagleView mapping.',
    }
  }

  const { data, error } = await supabase.functions.invoke<EagleViewMapConfig>('eagleview-map-tile', {
    body: { action: 'config' },
  })

  if (error) {
    return {
      configured: false,
      tileSize: 256,
      minZoom: 1,
      maxZoom: 22,
      provider: 'eagleview',
      message: error.message,
    }
  }

  return data ?? {
    configured: false,
    tileSize: 256,
    minZoom: 1,
    maxZoom: 22,
    provider: 'eagleview',
    message: 'EagleView map configuration returned no response.',
  }
}

export async function eagleViewTile(z: number, x: number, y: number): Promise<Blob> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Sign in to use EagleView mapping.')

  const { data, error } = await supabase.functions.invoke<Blob>('eagleview-map-tile', {
    body: { action: 'tile', z, x, y },
  })

  if (error) throw new Error(error.message)
  if (!(data instanceof Blob)) throw new Error('EagleView returned an unreadable map tile.')
  return data
}
