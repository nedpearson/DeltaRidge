-- =============================================================================
-- 0015  Parcel-sourced owner facts, with provenance -- and one suppression list
-- =============================================================================
-- Two tables that have nothing to do with each other except that both exist to
-- stop the same class of mistake: saying something to a homeowner that the
-- record does not support.
--
-- 1. property_parcels
--
--    The door list now carries the assessor's owner name on almost every door.
--    That name will be spoken out loud on a doorstep, so where it came from and
--    when it was read have to travel with it. A name with no date behind it is
--    worse than no name, because it will be used with confidence.
--
--    Deliberately NOT merged into `properties` or `customers`. `properties` is
--    what Delta Ridge knows about a roof it has worked on; this is what the
--    parish publishes about a parcel, refreshed on the parish's schedule and
--    overwritten wholesale when it is. `customers` is a person the company has
--    a relationship with -- a recorded owner is not that, and promoting every
--    parcel owner into `customers` would fill the CRM with thousands of people
--    nobody has ever spoken to.
--
-- 2. contact_suppressions
--
--    Built now, before any outbound channel exists. Delta Ridge knocks and
--    mails today; no number is dialled from this app. But the moment a rep is
--    told "don't contact me again" at a door, that has to be recorded
--    somewhere permanent, and it has to still be there on the day a phone or an
--    email channel is switched on.
--
--    Keyed on the contact point, NOT on a lead and NOT on a channel. The FCC
--    revocation rule in force since April 2025 makes an opt-out cross-channel:
--    someone who says stop has said stop to calls, texts and mail alike, by any
--    reasonable method. One row therefore suppresses every channel. The FCC's
--    internal do-not-call rule requires honouring such a request for five
--    years; this table has no expiry and nothing in the application deletes
--    from it, which is the simplest way to be sure of that.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What the parish assessor says about a parcel
-- -----------------------------------------------------------------------------
create table property_parcels (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  -- Nullable: a parcel is worth caching before anyone has worked the address.
  property_id          uuid references properties (id) on delete set null,

  -- Which roll this came from. 'ebr' today; Ascension and Regrid would be rows
  -- here rather than columns, which is why the provider is stored per record.
  provider             text not null,
  parcel_number        text not null,
  parish               text not null,

  situs_address        text not null,
  normalized_address   text generated always as (
                         app.normalize_address(situs_address)
                       ) stored,

  owner_name           text not null,
  -- person / trust / company / government / unknown. Classified from the
  -- recorded string, never parsed into given and family names: entity owners
  -- are common and splitting them puts a wrong name in a rep's mouth.
  owner_kind           text not null default 'unknown',
  owner_mailing_address text,
  owner_mailing_locality text,

  -- owner_occupied / likely_absentee / unknown. "Likely" is load-bearing: the
  -- weaker signal is a tax bill going elsewhere, and a PO box is not a tenant.
  occupancy            text not null default 'unknown',
  -- homestead_exemption / mailing_matches / mailing_differs / unknown.
  -- Stored so the screen can show WHY, and so a future rule change can be
  -- applied to old rows without re-reading the parish.
  occupancy_basis      text not null default 'unknown',
  homestead_exemption  numeric(14, 2),

  subdivision          text,
  flood_zone           text,
  legal_description    text,

  -- Assessed value only. East Baton Rouge publishes improvement value and fair
  -- market value as columns and leaves both empty on every parcel sampled
  -- (0 of 2,000), so storing them would put a zero on screen that reads as a
  -- fact. If a parish ever populates them, add the columns then.
  assessed_value       numeric(14, 2),
  land_value           numeric(14, 2),

  location             geography(Point, 4326),
  boundary             geography(Polygon, 4326),

  -- Provenance. `retrieved_at` is when this application read it; the parish
  -- does not publish a per-record update time, which is itself worth recording
  -- by its absence rather than faking one.
  retrieved_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint property_parcels_provider check (provider in ('ebr', 'ascension', 'regrid')),
  constraint property_parcels_owner_kind check (
    owner_kind in ('person', 'trust', 'company', 'government', 'unknown')
  ),
  constraint property_parcels_occupancy check (
    occupancy in ('owner_occupied', 'likely_absentee', 'unknown')
  ),
  constraint property_parcels_occupancy_basis check (
    occupancy_basis in ('homestead_exemption', 'mailing_matches', 'mailing_differs', 'unknown')
  ),
  -- An occupancy claim without a basis is an assertion nobody can check.
  constraint property_parcels_occupancy_has_basis check (
    occupancy = 'unknown' or occupancy_basis <> 'unknown'
  ),
  constraint property_parcels_identity unique (organization_id, provider, parcel_number)
);

create index on property_parcels (organization_id, normalized_address);
create index on property_parcels (organization_id, property_id);
create index on property_parcels using gist (location);
-- Finding every parcel not read for a month is the refresh job's only query.
create index on property_parcels (organization_id, retrieved_at);

alter table property_parcels enable row level security;
create policy property_parcels_org_access on property_parcels
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

comment on table property_parcels is
  'What a parish assessor publishes about a parcel, with the time it was read. '
  'Not a customer record and not a Delta Ridge property record.';
comment on column property_parcels.occupancy is
  'likely_absentee is deliberately hedged: the signal is a tax bill going '
  'elsewhere, which a PO box produces just as readily as a rental.';
comment on column property_parcels.assessed_value is
  'The only value the parish populates. Improvement and fair-market value are '
  'empty on every EBR parcel sampled, so they are not stored.';

-- -----------------------------------------------------------------------------
-- Do not contact. One list, every channel, no expiry.
-- -----------------------------------------------------------------------------
create table contact_suppressions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,

  -- 'phone' or 'email' or 'address'. What KIND of contact point this is --
  -- not which channel is suppressed. Every channel is.
  contact_kind     text not null,
  -- Normalised at write time: digits only for a phone, lowercased and trimmed
  -- for an email. A suppression that does not match on the next lookup is not
  -- a suppression.
  contact_value    text not null,

  -- How the request arrived, in the words of the rule that governs it:
  -- 'verbal_at_door', 'reply_stop', 'unsubscribe_link', 'written', 'staff_entry'.
  method           text not null,
  -- Free text, verbatim where there is any. The FCC treats revocation by "any
  -- reasonable method", so what was actually said is the record that matters.
  request_text     text,

  requested_at     timestamptz not null default now(),
  -- When outbound actually stopped. Separate from requested_at on purpose:
  -- the gap between them is the number a regulator asks about.
  honored_at       timestamptz not null default now(),
  recorded_by      uuid references auth.users (id) on delete set null,
  -- Where it came from, if it came from a door.
  lead_id          uuid references leads (id) on delete set null,

  created_at       timestamptz not null default now(),

  constraint contact_suppressions_kind check (contact_kind in ('phone', 'email', 'address')),
  constraint contact_suppressions_method check (
    method in ('verbal_at_door', 'reply_stop', 'unsubscribe_link', 'written', 'staff_entry')
  ),
  constraint contact_suppressions_value_present check (length(trim(contact_value)) > 0),
  -- Re-recording the same request must not create a second row, but it must
  -- also never fail a write and lose the request.
  constraint contact_suppressions_identity unique (organization_id, contact_kind, contact_value)
);

create index on contact_suppressions (organization_id, contact_kind, contact_value);
create index on contact_suppressions (organization_id, lead_id);

alter table contact_suppressions enable row level security;

-- Insert and read, for anyone in the organisation. There is deliberately no
-- delete policy and no update policy: an opt-out is not editable and not
-- removable through the application, by anyone, at any level. Purchasing new
-- contact data for someone does not un-say what they said.
create policy contact_suppressions_read on contact_suppressions
  for select
  using (organization_id in (select app.current_org_ids()));
create policy contact_suppressions_insert on contact_suppressions
  for insert
  with check (organization_id in (select app.current_org_ids()));

comment on table contact_suppressions is
  'Do-not-contact requests. One row suppresses EVERY channel, because the FCC '
  'revocation rule in force since April 2025 makes an opt-out cross-channel. '
  'No expiry, no delete policy: the internal do-not-call rule requires five '
  'years and never deleting is the simplest way to be sure of it.';
comment on column contact_suppressions.honored_at is
  'When outbound actually stopped. The gap from requested_at is the number a '
  'regulator asks about.';
