/**
 * A stable identity for this phone.
 *
 * Needed because the outbox has to answer a question it could not previously
 * ask: *whose* work is this? A field phone gets handed around, a rep signs out
 * at the end of a shift, a token expires mid-street. Without a device identity
 * the queue is anonymous, and an anonymous queue drained by whoever happens to
 * sign in next attributes one rep's doors to another.
 *
 * Deliberately NOT a fingerprint. It is a random id this app generated and
 * stored; it says nothing about the hardware, follows no one between apps, and
 * a rep who clears site data simply gets a new one — which costs an attribution
 * label, not any work, because ownership is enforced on user id as well.
 */

const KEY = 'delta-ridge.device-id'

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

let cached: string | null = null

/**
 * Reads the id, creating one on first call.
 *
 * localStorage rather than IndexedDB on purpose: this is read on every enqueue,
 * including from synchronous code paths, and it must never be the reason a
 * knock fails to save. Every access is wrapped — private mode, blocked storage
 * and quota errors all degrade to an in-memory id that lasts the session,
 * because a queue item labelled with a temporary device is still better than a
 * knock that was not recorded.
 */
export function deviceId(): string {
  if (cached) return cached
  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing) {
      cached = existing
      return existing
    }
    const created = randomId()
    window.localStorage.setItem(KEY, created)
    cached = created
    return created
  } catch {
    cached = randomId()
    return cached
  }
}

/** Test seam. */
export function resetDeviceIdCache(): void {
  cached = null
}
