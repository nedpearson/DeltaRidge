import { loadEnv } from './env'

export interface BackendStatus {
  configured: boolean
  reason?: string
}

/**
 * Tolerant wrapper around the strict env loader.
 *
 * `loadEnv` throws on invalid configuration, which is correct for a server or a
 * build step. In the field app a missing backend must degrade to "working
 * offline", not a white screen — the rep's photos are safe in IndexedDB either
 * way, and losing the whole UI because an env var is absent would be the worst
 * possible failure mode on a roof.
 */
export function backendStatus(): BackendStatus {
  try {
    loadEnv()
    return { configured: true }
  } catch {
    return {
      configured: false,
      reason: 'Not connected to the Delta Ridge server. Everything is saved on this device and will sync once the backend is configured.',
    }
  }
}
