/**
 * When a waiting service worker is allowed to take over.
 *
 * Two failure modes, and the fix has to avoid both.
 *
 * Reloading under a rep who is halfway through an inspection is hostile - the
 * work is safe in IndexedDB, but losing the half-typed note and the camera
 * they had open is not something to do to someone standing on a driveway.
 *
 * A prompt they can ignore forever is the other failure, and it is the one
 * that actually happened: the new worker installed, parked in `waiting`, and
 * the app kept serving last week's bundle with a banner nobody tapped.
 *
 * So: apply automatically the moment it is SAFE, and only ask when it is not.
 * Anything that would be disruptive to interrupt takes a hold; the update
 * applies by itself as soon as the last hold is released.
 */

export type UpdateFn = (reload?: boolean) => Promise<void> | void

export interface UpdateState {
  readonly available: boolean
  /** Human-readable reasons an update is being held back, in order taken. */
  readonly holds: readonly string[]
}

let updateFn: UpdateFn | null = null
const holds = new Map<symbol, string>()
const listeners = new Set<(state: UpdateState) => void>()

function snapshot(): UpdateState {
  return { available: updateFn !== null, holds: [...holds.values()] }
}

function emit(): void {
  const state = snapshot()
  for (const listener of listeners) listener(state)
}

export function subscribeToUpdates(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener)
  listener(snapshot())
  return () => {
    listeners.delete(listener)
  }
}

export function setUpdateAvailable(fn: UpdateFn): void {
  updateFn = fn
  emit()
}

/**
 * Hold the update back while something uninterruptible is on screen. Returns
 * the release function, so a React effect can hand it straight back as its
 * cleanup and a hold can never outlive the thing that took it.
 */
export function holdUpdates(reason: string): () => void {
  const key = Symbol(reason)
  holds.set(key, reason)
  emit()
  return () => {
    holds.delete(key)
    emit()
  }
}

/** Pure policy, so the decision is testable without a service worker. */
export function shouldApplyNow(state: UpdateState): boolean {
  return state.available && state.holds.length === 0
}

export function applyUpdate(): void {
  const fn = updateFn
  if (!fn) return
  // Cleared first: applying reloads the page, and a double-apply during the
  // teardown would race the reload.
  updateFn = null
  void fn(true)
}

/** Test seam. Not used by the app. */
export function resetUpdateStateForTests(): void {
  updateFn = null
  holds.clear()
  listeners.clear()
}
