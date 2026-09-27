-- =============================================================================
-- 0010  Client ids on the remaining field-captured tables
-- =============================================================================
-- `photos` and `voice_notes` already carry a client-generated `client_id` with
-- a unique constraint, which is what makes a retried upload safe. `inspections`
-- and `inspection_observations` did not, so the push layer could only INSERT
-- them — and an insert that succeeds on the server but whose acknowledgement
-- never reaches the phone (app killed, signal dropped between the write and the
-- response) is retried and creates a second copy of the same roof inspection.
--
-- The same column also turns the push into an UPSERT, which fixes a quieter and
-- worse bug: an inspection was pushed once, on creation, and every later edit —
-- the completion time, the rep's recommendation, the homeowner's stated roof
-- age, the override note — stayed on the phone forever. The office saw a
-- permanently in-progress shell.
--
-- `office_handoffs` gets one too, keyed to the local inspection id, so a rep
-- who taps Send twice gets one handoff row, not two.
--
-- Backfill uses the existing primary key, which is unique by definition, so
-- rows written before this migration keep a stable identity.
-- =============================================================================

alter table inspections add column if not exists client_id uuid;
update inspections set client_id = id where client_id is null;
alter table inspections alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table inspections alter column client_id set default gen_random_uuid();
alter table inspections
  add constraint inspections_org_client_unique unique (organization_id, client_id);

comment on column inspections.client_id is
  'UUID generated on the device before the row ever reaches the server. The '
  'conflict target for upserts, so a retried push updates rather than duplicates.';

alter table inspection_observations add column if not exists client_id uuid;
update inspection_observations set client_id = id where client_id is null;
alter table inspection_observations alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table inspection_observations alter column client_id set default gen_random_uuid();
alter table inspection_observations
  add constraint observations_org_client_unique unique (organization_id, client_id);

comment on column inspection_observations.client_id is
  'Device-generated UUID; conflict target for idempotent upserts.';

-- One handoff per local inspection per organization. Note this coexists with
-- office_handoffs_one_live: an upsert on (organization_id, client_id) resolves
-- to an UPDATE of the same row, so the partial "one live handoff per
-- inspection" index is never challenged by a resend.
alter table office_handoffs add column if not exists client_id uuid;
update office_handoffs set client_id = inspection_id where client_id is null;
alter table office_handoffs alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table office_handoffs alter column client_id set default gen_random_uuid();
alter table office_handoffs
  add constraint office_handoffs_org_client_unique unique (organization_id, client_id);

comment on column office_handoffs.client_id is
  'The local inspection id. Tapping Send to office twice updates one row.';
