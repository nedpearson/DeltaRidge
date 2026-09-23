import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { getRemoteId, setRemoteId, setRemoteIdScope } from '@/lib/sync-store'

/**
 * A local id is a claim that "this row of mine is that row of theirs", and
 * *theirs* is one organisation's database.
 *
 * Unscoped, a phone used by reps from two different companies resolves one
 * org's local id to the other org's remote id — and the next push updates a
 * lead inside a company the rep does not work for. Nothing about that failure
 * looks like an error at any layer: the request succeeds, the row exists, and
 * the wrong CRM quietly gains a knock.
 */

const ACME = 'aaaaaaaa-0000-4000-8000-000000000001'
const RIVAL = 'bbbbbbbb-0000-4000-8000-000000000002'

async function wipe(): Promise<void> {
  const db = await openDB('delta-ridge-sync', 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('remoteIds')) d.createObjectStore('remoteIds', { keyPath: 'id' })
    },
  })
  await db.clear('remoteIds')
  db.close()
}

describe('remote id scoping', () => {
  beforeEach(async () => {
    await wipe()
    setRemoteIdScope(null)
  })

  it('keeps one organisation from resolving another organisation ids', async () => {
    setRemoteIdScope(ACME)
    await setRemoteId('lead', 'local-1', 'acme-remote-1')

    setRemoteIdScope(RIVAL)
    expect(await getRemoteId('lead', 'local-1')).toBeNull()
  })

  it('lets two organisations hold their own mapping for the same local id', async () => {
    setRemoteIdScope(ACME)
    await setRemoteId('lead', 'local-1', 'acme-remote-1')
    setRemoteIdScope(RIVAL)
    await setRemoteId('lead', 'local-1', 'rival-remote-1')

    setRemoteIdScope(ACME)
    expect(await getRemoteId('lead', 'local-1')).toBe('acme-remote-1')
    setRemoteIdScope(RIVAL)
    expect(await getRemoteId('lead', 'local-1')).toBe('rival-remote-1')
  })

  it('shares a mapping between reps of the same organisation', async () => {
    // Deliberate: two reps working one street must see the same lead, so the
    // scope is the organisation and not the user.
    setRemoteIdScope(ACME)
    await setRemoteId('lead', 'local-1', 'acme-remote-1')
    setRemoteIdScope(ACME)
    expect(await getRemoteId('lead', 'local-1')).toBe('acme-remote-1')
  })

  it('adopts mappings written before scoping existed', async () => {
    // There was only ever one organisation on a device then. Dropping these
    // instead would make every lead already on the phone insert a second time.
    const db = await openDB('delta-ridge-sync', 1)
    await db.put('remoteIds', {
      id: 'lead:legacy-1',
      entity: 'lead',
      localId: 'legacy-1',
      remoteId: 'remote-legacy-1',
      syncedAt: '2026-09-01T00:00:00.000Z',
    })
    db.close()

    setRemoteIdScope(ACME)
    expect(await getRemoteId('lead', 'legacy-1')).toBe('remote-legacy-1')
  })

  it('does not re-read the legacy row once it has been adopted', async () => {
    const db = await openDB('delta-ridge-sync', 1)
    await db.put('remoteIds', {
      id: 'lead:legacy-1',
      entity: 'lead',
      localId: 'legacy-1',
      remoteId: 'remote-legacy-1',
      syncedAt: '2026-09-01T00:00:00.000Z',
    })
    db.close()

    setRemoteIdScope(ACME)
    await getRemoteId('lead', 'legacy-1')

    const after = await openDB('delta-ridge-sync', 1)
    const adopted = await after.get('remoteIds', `${ACME}:lead:legacy-1`)
    after.close()
    expect(adopted).toBeDefined()
  })

  it('separates entities that happen to share a local id', async () => {
    setRemoteIdScope(ACME)
    await setRemoteId('lead', 'same-id', 'lead-remote')
    await setRemoteId('property', 'same-id', 'property-remote')
    expect(await getRemoteId('lead', 'same-id')).toBe('lead-remote')
    expect(await getRemoteId('property', 'same-id')).toBe('property-remote')
  })
})
