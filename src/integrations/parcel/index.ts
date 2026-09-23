import { EbrParcelProvider } from './ebr'
import type { ParcelProvider, ParcelProviderId } from './types'

export * from './types'
export {
  ADDRESS_BATCH_SIZE,
  chunkAddresses,
  classifyOwner,
  decideOccupancy,
  EbrParcelProvider,
  POISONED_FIELDS,
} from './ebr'

/**
 * Which parish assessor to ask.
 *
 * Only East Baton Rouge is implemented, and that is stated rather than hidden:
 * asking for a parish we cannot reach returns a provider that reports itself
 * unavailable with the reason, so the screen can say "Ascension parcels are not
 * available" instead of showing a door with no owner and no explanation.
 */
class UnsupportedParcelProvider implements ParcelProvider {
  readonly displayName: string
  readonly attribution = ''
  readonly coverage: string
  readonly mayPersist = false

  constructor(readonly id: ParcelProviderId, parishLabel: string) {
    this.displayName = `${parishLabel} parcels`
    this.coverage = `${parishLabel} publishes no parcel service this app can read.`
  }

  async availability() {
    return {
      available: false,
      reason: `${this.displayName} are not available. Only East Baton Rouge publishes a parcel service we can read without a licence.`,
      actionable: false,
    }
  }

  async search() {
    return []
  }

  async lookupByAddresses() {
    return new Map<string, never>() as never
  }
}

export function createParcelProvider(
  which: ParcelProviderId,
  fetchImpl: typeof fetch = globalThis.fetch,
): ParcelProvider {
  switch (which) {
    case 'ebr':
      return new EbrParcelProvider(fetchImpl)
    case 'ascension':
      return new UnsupportedParcelProvider('ascension', 'Ascension Parish')
    case 'regrid':
      return new UnsupportedParcelProvider('regrid', 'Regrid')
    default:
      return new EbrParcelProvider(fetchImpl)
  }
}
