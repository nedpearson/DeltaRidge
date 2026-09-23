/**
 * Small durable facts about syncing, for the screen that has to explain it.
 *
 * Deliberately localStorage and not IndexedDB: this is diagnostic bookkeeping,
 * not the rep's work, and it must never be a reason a drain fails. Every access
 * is wrapped — losing "last synced 14:12" costs a line on a diagnostics screen,
 * which is not worth a single failed push.
 *
 * Two timestamps because they answer different questions, and conflating them
 * is how an app claims to be working when it is not:
 *
 *   `lastDrainAt`  — the last time a drain ran with a session and reached the
 *                    end without a failure. An empty queue counts.
 *   `lastPushAt`   — the last time the SERVER acknowledged a row. This is the
 *                    only one that proves the round trip exists. A queue that
 *                    has never had anything in it drains cleanly forever and
 *                    tells you nothing.
 */

const DRAIN_KEY = 'delta-ridge.last-drain-at'
const PUSH_KEY = 'delta-ridge.last-push-at'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode, blocked storage, quota. Not worth failing a push over.
  }
}

export interface SyncMeta {
  /** Last clean drain, empty queue included. */
  lastDrainAt: string | null
  /** Last server acknowledgement of a real row. */
  lastPushAt: string | null
}

export function readSyncMeta(): SyncMeta {
  return { lastDrainAt: read(DRAIN_KEY), lastPushAt: read(PUSH_KEY) }
}

export function recordDrain(pushed: number, failed: number, at: string = new Date().toISOString()): void {
  if (pushed > 0) write(PUSH_KEY, at)
  if (failed === 0) write(DRAIN_KEY, at)
}
