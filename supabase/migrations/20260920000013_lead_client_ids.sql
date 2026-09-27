-- =============================================================================
-- 0013  Client ids on the CRM tables the field app writes
-- =============================================================================
-- Leads, activities and appointments are captured on a phone in a driveway,
-- often with no signal, and pushed later. Without a device-generated identity
-- the push layer can only INSERT, and an insert whose acknowledgement never
-- arrives — app killed, signal dropped between the write and the response — is
-- retried and creates a second copy of the same conversation.
--
-- The same column turns every push into an UPSERT, which matters more here
-- than anywhere else: a lead's whole value is that its STATUS moves. Pushing
-- once on creation would leave the office looking at a lead that is forever
-- "attempted" while the rep has since booked, inspected and sold it.
--
-- Backfill uses the existing primary key, which is unique by definition, so
-- rows written before this migration keep a stable identity.
-- =============================================================================

alter table leads add column if not exists client_id uuid;
update leads set client_id = id where client_id is null;
alter table leads alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table leads alter column client_id set default gen_random_uuid();
alter table leads
  add constraint leads_org_client_unique unique (organization_id, client_id);

comment on column leads.client_id is
  'UUID generated on the device before the row ever reaches the server. The '
  'conflict target for upserts, so a retried push updates rather than duplicates.';

alter table activities add column if not exists client_id uuid;
update activities set client_id = id where client_id is null;
alter table activities alter column client_id set not null;
alter table activities alter column client_id set default gen_random_uuid();
alter table activities
  add constraint activities_org_client_unique unique (organization_id, client_id);

comment on column activities.client_id is
  'Device-generated UUID. A knock recorded once offline and pushed twice is '
  'one row, not two, which is the difference between a contact history and a '
  'pile of duplicates.';

alter table appointments add column if not exists client_id uuid;
update appointments set client_id = id where client_id is null;
alter table appointments alter column client_id set not null;
alter table appointments alter column client_id set default gen_random_uuid();
alter table appointments
  add constraint appointments_org_client_unique unique (organization_id, client_id);

comment on column appointments.client_id is
  'The local lead id. Rescheduling on the phone updates one appointment row.';

-- -----------------------------------------------------------------------------
-- Do-not-contact has to be answerable without scanning every lead.
--
-- A rep about to knock, and any future messaging, must be able to ask "is this
-- address off limits?" cheaply. Leaving that as a sequential scan over leads is
-- how a do-not-knock request quietly stops being honoured once the table grows.
-- -----------------------------------------------------------------------------
create index if not exists leads_do_not_contact
  on leads (organization_id, property_id)
  where deleted_at is null and status = 'do_not_contact';

-- Activities are read newest-first for one lead, constantly. The existing
-- (lead_id, occurred_at desc) index covers it; this one covers the other read
-- that matters — what a rep did today, across every lead.
create index if not exists activities_by_user_day
  on activities (organization_id, user_id, occurred_at desc);
