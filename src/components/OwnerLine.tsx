import type { OwnerKind, ParcelRecord } from '@/integrations/parcel'

/**
 * Who owns this, and whether they live there.
 *
 * Three things are load-bearing here and none of them are decoration.
 *
 * The name is printed exactly as the assessor recorded it. It is never split
 * into a first and last name, because "S & L THOMAS LIVING TRUST DATED
 * FEBRUARY 27, 2023" is a real owner on a real Baton Rouge street and guessing
 * at "Mr Thomas" puts a wrong name in a rep's mouth on a doorstep.
 *
 * Entity ownership is called out, because a trust or an LLC usually means
 * nobody is home to sign and the conversation is a different one.
 *
 * Occupancy says LIKELY absentee, never absentee. The signal behind it is a
 * tax bill going somewhere else, and a PO box looks exactly like a rental.
 */

const ENTITY_LABEL: Partial<Record<OwnerKind, string>> = {
  trust: 'Trust',
  company: 'Company',
  government: 'Government',
}

export function OwnerLine({ parcel }: { parcel: ParcelRecord | undefined }) {
  if (!parcel) {
    // Stated, not blank. "No owner shown" and "we did not look" are different
    // things and a rep should be able to tell which one he is looking at.
    return (
      <p className="mt-2 text-[12.5px] text-slate-600">
        No parish parcel matched this address — no owner on record to show.
      </p>
    )
  }

  const entity = ENTITY_LABEL[parcel.ownerKind]

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="min-w-0 truncate text-[13.5px] font-semibold text-slate-600">
        {parcel.ownerName}
      </p>
      {entity && (
        <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-slate-600">
          {entity}
        </span>
      )}
      {parcel.occupancy === 'owner_occupied' && (
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] text-emerald-300">
          Owner occupied
        </span>
      )}
      {parcel.occupancy === 'likely_absentee' && (
        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] text-amber-300">
          Likely absentee
        </span>
      )}
    </div>
  )
}

/** The evidence behind the badge, for the places that have room to show it. */
export function occupancyEvidence(parcel: ParcelRecord): string {
  switch (parcel.occupancyBasis) {
    case 'homestead_exemption':
      return 'A homestead exemption is filed on this parcel. Louisiana grants it only on a primary residence.'
    case 'mailing_matches':
      return 'The tax bill goes to the property address.'
    case 'mailing_differs':
      return 'The tax bill goes somewhere else. Often a rental — but a PO box looks the same.'
    case 'unknown':
      return 'The parcel record gives no occupancy signal either way.'
  }
}
