import { NoaaStormProvider } from './noaa'
import { HailTraceStormProvider } from './hailtrace'
import { SwdiStormProvider } from './swdi'
import { MrmsStormProvider } from './mrms'
import type { ProviderAvailability, StormProvider } from './types'

export * from './types'
export { NoaaStormProvider } from './noaa'
export { HailTraceStormProvider } from './hailtrace'
export { SwdiStormProvider, SwdiTruncatedError } from './swdi'
export { MrmsStormProvider } from './mrms'

/** A provider that is switched off entirely. Still a valid configuration. */
class DisabledStormProvider implements StormProvider {
  readonly id = 'noaa' as const
  readonly displayName = 'Storm data disabled'
  readonly attribution = ''
  readonly mayPersistGeometry = false
  async availability(): Promise<ProviderAvailability> {
    return { available: false, reason: 'Storm data is turned off for this workspace.', actionable: true }
  }
  async searchEvents() {
    return []
  }
  async eventGeometry() {
    return null
  }
}

export function createStormProvider(
  which: 'noaa' | 'hailtrace' | 'swdi' | 'mrms' | 'none',
  fetchImpl: typeof fetch = globalThis.fetch,
): StormProvider {
  switch (which) {
    case 'hailtrace':
      return new HailTraceStormProvider()
    case 'swdi':
      return new SwdiStormProvider(fetchImpl)
    case 'mrms':
      return new MrmsStormProvider()
    case 'none':
      return new DisabledStormProvider()
    case 'noaa':
    default:
      return new NoaaStormProvider(fetchImpl)
  }
}
