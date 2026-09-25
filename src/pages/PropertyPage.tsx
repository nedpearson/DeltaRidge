import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { OwnerLine, occupancyEvidence } from '@/components/OwnerLine'
import RoofView from '@/components/RoofView'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import ContactActions from '@/components/ContactActions'
import { findByAddress } from '@/features/leads/lead-store'
import {
  CONTACT_SOURCE_LABEL,
  contactSourceOf,
  mayContact,
  type ManagedLead,
} from '@/features/leads/pipeline'
import { mayCallAt } from '@/features/compliance/engine'
import { ALL_SOLICITATION_RULES } from '@/features/compliance/solicitation'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { buildPropertyProfile, type PropertyProfile } from '@/features/leads/property-profile'
import type { ScoredLead } from '@/features/leads/scoring'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import type { PermitRecord } from '@/integrations/permits/types'
import { streetLineOf } from '@/integrations/geocode/ebr'
import { distanceMiles } from '@/features/leads/scoring'
import type { Fact } from '@/lib/provenance'
import type { ParcelRecord } from '@/integrations/parcel'
import type { StormEvent } from '@/integrations/storm'
import RoofImageryPanel from '@/features/imagery/RoofImageryPanel'

/**
 * Everything known about one address, with the source of every claim on screen.
 *
 * The door card answers "is this worth walking up to". This screen answers the
 * questions that come after yes: who owns it, do they live there, how old is
 * the roof really, who worked on this house before, what actually hit it.
 *
 * Two rules run through the whole page.
 *
 * Every fact shows where it came from and how certain it is. A rep is going to
 * repeat these numbers to a homeowner, and a number he cannot attribute is a
 * number he should not say out loud.
 *
 * A field we cannot source is NAMED, with the reason. The parish publishes no
 * bedrooms, no square footage, no sale history — so this page says that, rather
 * than showing an empty row that reads like a loading state or, worse, a zero.
 */

type Tab = 'property' | 'owner' | 'roof' | 'storms' | 'permits'

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'property', label: 'Property' },
  { key: 'owner', label: 'Owner' },
  { key: 'roof', label: 'Roof' },
  { key: 'storms', label: 'Storms' },
  { key: 'permits', label: 'Permits' },
]

/** Miles either side of the parcel that count as "this storm hit here". */
const STORM_RADIUS_MILES = 5

export default function PropertyPage() {
  const { addressKey = '' } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState<LeadRun | null>(null)
  const [permits, setPermits] = useState<PermitRecord[] | null>(null)
  const [permitError, setPermitError] = useState(false)
  const [tab, setTab] = useState<Tab>('property')
  /*
   * The managed lead for this address, if the rep has already worked it.
   *
   * This screen is parcel research and holds no contact details of its own —
   * that is deliberate and stays true. But once a homeowner has actually given
   * a number at the door, it lives on the lead, and making the rep navigate
   * back to the door list to dial it is the friction this whole change is
   * about. Null simply means nobody has knocked here yet.
   */
  const [managed, setManaged] = useState<ManagedLead | null>(null)

  useEffect(() => {
    if (addressKey === '') return
    void findByAddress(addressKey).then(setManaged)
  }, [addressKey])

  useEffect(() => {
    void readCachedRun().then(setRun)
  }, [])

  const lead: ScoredLead | undefined = useMemo(
    () => run?.leads.find((l) => l.addressKey === decodeURIComponent(addressKey)),
    [run, addressKey],
  )

  const loadPermits = useCallback(async (address: string) => {
    setPermitError(false)
    try {
      // The whole permit history for this one address, not just roofing: a pool
      // permit dates the back yard, a generator permit says somebody spends
      // money on this house, and both are worth a rep knowing at the door.
      const rows = await new EbrPermitProvider().search({
        kinds: ['reroof', 'new_build', 'other'],
        addressLike: streetLineOf(address),
        limit: 100,
      })
      setPermits(rows)
    } catch {
      setPermitError(true)
      setPermits([])
    }
  }, [])

  useEffect(() => {
    if (lead) void loadPermits(lead.address)
  }, [lead, loadPermits])

  const profile: PropertyProfile | null = useMemo(() => {
    if (!lead) return null
    const nearby = (run?.stormEvents ?? []).filter(
      (s) => distanceMiles(lead.latitude, lead.longitude, s.latitude, s.longitude) <= STORM_RADIUS_MILES,
    )
    return buildPropertyProfile({
      address: lead.address,
      addressKey: lead.addressKey,
      ...(lead.parcel ? { parcel: lead.parcel } : {}),
      permits: permits ?? [lead.roofPermit],
      storms: nearby,
      now: new Date(),
    })
  }, [lead, permits, run])

  if (!run) {
    return <p className="mt-8 text-center text-[13px] text-[var(--color-ink)]/">Opening the property…</p>
  }

  if (!lead || !profile) {
    return (
      <Empty
        title="Not on the current list"
        body="This address is not in the door list as it stands. Rebuild the list on the Leads screen and open it again."
      />
    )
  }

  return (
    <div>
      <button
        onClick={() => navigate('/leads')}
        className="!min-h-0 py-1 text-[12px] text-[var(--color-ink)]/"
      >
        ← Doors
      </button>

      <Card className="mt-2">
        {/*
          The controls are inline here rather than behind a tap, because this is
          the screen a rep opens when they have already decided the roof is worth
          looking at properly. On the door list the same view is one tap away,
          where the list itself is the thing being scanned.
        */}
        <div className="mb-3">
          <RoofView
            latitude={lead.latitude}
            longitude={lead.longitude}
            address={lead.address}
            boundary={lead.parcel?.boundary}
          />
        </div>
        <p className="text-[17px] font-semibold leading-tight">{lead.address}</p>
        <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/">
          {[lead.subdivision, lead.city].filter(Boolean).join(' · ') || 'East Baton Rouge Parish'}
        </p>
        <OwnerLine parcel={lead.parcel} />
      </Card>

      {/*
        Actions first, tabs second. The rep's highest-frequency needs — reach
        this person, drive to this house — sit above the drill-down, because
        scrolling through ownership metadata to find a phone number is the
        friction that stops an app being used on a driveway.
      */}
      {managed !== null ? (
        <PropertyContactBar lead={managed} />
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-200 px-3 py-2.5">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="contents"
          >
            <Button variant="secondary">Navigate</Button>
          </a>
          {/* Honest about why there is nothing to dial: no number has been
              collected here, rather than a broken or empty control. */}
          <p className="min-w-0 flex-1 text-[11.5px] leading-tight text-[var(--color-ink)]/">
            Nobody has knocked here yet, so there is no phone number to call.
          </p>
        </div>
      )}

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] ${
              tab === t.key ? 'bg-gold-500/20 text-gold-300' : 'bg-slate-200 text-[var(--color-ink)]/'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'property' && <PropertyTab profile={profile} latitude={lead.latitude} longitude={lead.longitude} />}
        {tab === 'owner' && <OwnerTab profile={profile} {...(lead.parcel ? { parcel: lead.parcel } : {})} />}
        {tab === 'roof' && (
          <RoofTab
            profile={profile}
            
            
          />
        )}
        {tab === 'storms' && <StormsTab profile={profile} />}
        {tab === 'permits' && (
          <PermitsTab profile={profile} permits={permits} failed={permitError} />
        )}
      </div>
    </div>
  )
}

/**
 * One fact, with its provenance under it.
 *
 * The certainty word is the point. "Verified" means a record says so;
 * "estimated" means we derived it by a rule we can state; "unknown" means we
 * looked and there was nothing — which is why the basis line still prints.
 */
function FactRow<T>({
  label,
  fact,
  format = (v: T) => String(v),
}: {
  label: string
  fact: Fact<T>
  format?: (value: T) => string
}) {
  const known = fact.value !== null && fact.certainty !== 'unknown'
  return (
    <div className="border-t border-slate-300 py-2 first:border-t-0 first:pt-0">
      {/*
        `min-w-0` on both children, and it is not cosmetic. A flex item defaults
        to `min-width: auto`, which refuses to shrink below its content — so a
        long value such as a full mailing address pushed the row wider than the
        card and out of the viewport instead of wrapping. `break-words` then
        lets a long unbroken token break rather than doing the same thing again.

        No ellipsis: a truncated address is worse than a wrapped one, because a
        rep cannot tell what was cut off.
      */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 shrink-0 text-[12.5px] text-[var(--color-ink)]/">{label}</p>
        <p
          className={`min-w-0 break-words text-right text-[13.5px] ${known ? 'text-[var(--color-ink)]/' : 'text-[var(--color-ink)]/'}`}
        >
          {known ? format(fact.value as T) : 'Not on record'}
        </p>
      </div>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-ink)]/">
        {known && (
          <span className="uppercase tracking-wider text-[var(--color-ink)]/">{fact.certainty} · </span>
        )}
        {fact.source.label}
        {fact.basis ? ` — ${fact.basis}` : ''}
      </p>
    </div>
  )
}

const money = (n: number) => `$${n.toLocaleString()}`
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function PropertyTab({ 
  profile,
  latitude,
  longitude
}: { 
  profile: PropertyProfile
  latitude: number
  longitude: number
}) {
  return (
    <>
      <Card>
        <FactRow label="Parcel number" fact={profile.parcelNumber} />
        <FactRow label="Subdivision" fact={profile.subdivision} />
        <FactRow label="Flood zone" fact={profile.floodZone} />
        <FactRow label="Assessed value" fact={profile.assessedValue} format={money} />
        <FactRow label="Land value" fact={profile.landValue} format={money} />
      </Card>

      <RoofImageryPanel latitude={latitude} longitude={longitude} storms={profile.storms} autoFetch />

      <SectionTitle>NOT AVAILABLE</SectionTitle>
      <Card className="!py-3">
        {/* Named, with a reason each. An empty row reads as a loading state or
            a zero; a stated gap reads as a gap, and tells Ned exactly what a
            licensed data contract would buy him. */}
        <p className="text-[11.5px] leading-relaxed text-[var(--color-ink)]/">
          These are not published by the parish and are not in the permit feed. Filling them needs a
          licensed property-data provider under contract.
        </p>
        <ul className="mt-2 space-y-1">
          {profile.unavailable.map((f) => (
            <li key={f.field} className="flex justify-between gap-3 text-[12px]">
              <span className="text-[var(--color-ink)]/">{f.label}</span>
              <span className="text-right text-[11px] text-[var(--color-ink)]/">{f.reason}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function OwnerTab({ profile, parcel }: { profile: PropertyProfile; parcel?: ParcelRecord }) {
  return (
    <Card>
      <FactRow label="Recorded owner" fact={profile.owner.name} />
      <FactRow label="Mailing address" fact={profile.owner.mailingAddress} />
      <FactRow
        label="Occupancy"
        fact={profile.owner.occupancy}
        format={(v) =>
          v === 'owner_occupied'
            ? 'Owner occupied'
            : v === 'likely_absentee'
              ? 'Likely absentee'
              : 'Unknown'
        }
      />
      {parcel && (
        <p className="mt-2 border-t border-slate-300 pt-2 text-[11.5px] leading-relaxed text-[var(--color-ink)]/">
          {occupancyEvidence(parcel)}
        </p>
      )}
      {/*
        This used to read "contact details are not collected ... no number is
        dialled from here", which stopped being true when the door sheet gained
        a contact editor. A stale reassurance is worse than none: it describes a
        guarantee the software no longer makes.
      */}
      <p className="mt-2 border-t border-slate-300 pt-2 text-[11.5px] leading-relaxed text-[var(--color-ink)]/">
        No phone or email is appended to this parcel from a data broker. A number appears here only
        when a homeowner gave it at the door, and calling it is gated on consent and on Louisiana’s
        solicitation hours.
      </p>
    </Card>
  )
}

function RoofTab({
  profile,
}: {
  profile: PropertyProfile
}) {
  return (
    <>
      <Card>
        <FactRow label="Year built" fact={profile.roof.yearBuilt} />
        <FactRow label="Last re-roof permit" fact={profile.roof.lastReroofAt} format={shortDate} />
        <FactRow label="Roof age" fact={profile.roof.ageYears} format={(y) => `about ${y} years`} />
        <FactRow label="Last roofing contractor" fact={profile.roof.lastContractor} />
      </Card>
    </>
  )
}

function StormsTab({ profile }: { profile: PropertyProfile }) {
  if (profile.storms.length === 0) {
    return (
      <Empty
        title="No qualifying storms nearby"
        body={`No hail report in the current window fell within ${STORM_RADIUS_MILES} miles of this parcel.`}
      />
    )
  }
  return (
    <Card>
      {profile.storms.map((s: StormEvent) => (
        <div key={s.externalId} className="border-t border-slate-300 py-2 first:border-t-0 first:pt-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-[var(--color-ink)]/">
              {[s.city, s.countyParish].filter(Boolean).join(', ') || 'Unnamed location'}
            </p>
            <p className="shrink-0 font-display text-[15px] text-gold-400">
              {s.hailSizeInches !== undefined ? `${s.hailSizeInches}"` : '—'}
            </p>
          </div>
          <p className="mt-0.5 text-[10.5px] text-[var(--color-ink)]/">
            {shortDate(s.occurredAt)} · official ground report · NWS
          </p>
        </div>
      ))}
    </Card>
  )
}

function PermitsTab({
  profile,
  permits,
  failed,
}: {
  profile: PropertyProfile
  permits: PermitRecord[] | null
  failed: boolean
}) {
  if (failed) {
    return (
      <Empty
        title="Permit history unavailable"
        body="The parish permit service could not be reached. What is on the roof tab came from the list you already downloaded."
      />
    )
  }
  if (permits === null) {
    return <p className="text-center text-[13px] text-[var(--color-ink)]/">Reading the permit record…</p>
  }
  if (permits.length === 0) {
    return (
      <Empty
        title="No permits on file"
        body="East Baton Rouge has no permit records for this address. That is the parish answering, not a failure to look."
      />
    )
  }

  return (
    <Card>
      {[...permits]
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
        .map((p) => (
          <div key={p.externalId} className="border-t border-slate-300 py-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-[13px] text-[var(--color-ink)]/">{p.permitType}</p>
              <p className="shrink-0 text-[11.5px] text-[var(--color-ink)]/">{shortDate(p.issuedAt)}</p>
            </div>
            {p.contractorName && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-ink)]/">{p.contractorName}</p>
            )}
          </div>
        ))}
      <p className="mt-2 border-t border-slate-300 pt-2 text-[10.5px] leading-relaxed text-[var(--color-ink)]/">
        {profile.roof.lastReroofAt.value === null
          ? 'No re-roof permit appears above. A roof replaced without a permit leaves no record here, so this is strong evidence rather than proof.'
          : 'A re-roof permit records that work was authorised, not that it was finished.'}
      </p>
    </Card>
  )
}


/**
 * The lead screen's contact gates, applied on the property screen.
 *
 * Imported wholesale rather than reimplemented. Two copies of "may this number
 * be dialled" is how one of them quietly stops matching the law.
 */
function PropertyContactBar({ lead }: { lead: ManagedLead }) {
  const callBlock = mayContact(lead, 'call')
  const smsBlock = mayContact(lead, 'sms')
  const window = mayCallAt(
    ALL_SOLICITATION_RULES,
    { state: 'LA', parish: 'East Baton Rouge', municipality: null },
    new Date(),
  )
  const source = contactSourceOf(lead)

  return (
    <ContactActions
      phone={lead.contactPhone ?? null}
      phoneNote={source === null ? null : CONTACT_SOURCE_LABEL[source]}
      email={null}
      latitude={lead.latitude}
      longitude={lead.longitude}
      call={{
        allowed: callBlock.allowed && window.allowed,
        reason: !callBlock.allowed
          ? callBlock.reason
          : !window.allowed
            ? (window.reasons[0] ?? 'Outside the calling window')
            : null,
      }}
      text={{
        allowed: smsBlock.allowed && window.allowed,
        reason: !smsBlock.allowed
          ? smsBlock.reason
          : !window.allowed
            ? (window.reasons[0] ?? 'Outside the calling window')
            : null,
      }}
    />
  )
}
