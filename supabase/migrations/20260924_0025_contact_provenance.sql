-- =============================================================================
-- 0025  Where a phone number came from
-- =============================================================================
-- `customers.primary_phone` recorded a number and nothing about how it got
-- there. A number the homeowner said out loud at their door and a number off a
-- people-search service were the same row, and that distinction is the entire
-- question if a call is ever challenged: "we had their number" is not an
-- answer, and "she gave it to me at the door on the twelfth" is.
--
-- This is not a quality score. A looked-up number may well be correct. It is a
-- statement about whether this person handed it over, which is a different fact
-- and the one that decides whether the app will let anybody dial it.
--
-- NOT NULL is deliberately avoided: existing rows predate the question and
-- guessing an answer for them would be the exact failure this column exists to
-- prevent. The client reads a null as `homeowner_at_door` for rows it wrote
-- itself — the door sheet was the only code path that could set a number — and
-- says so in the open.
--
-- Rollback:
--   alter table customers drop column if exists phone_source;
-- Nothing below alters or drops existing data.
-- =============================================================================

alter table customers
  add column if not exists phone_source text;

alter table customers drop constraint if exists customers_phone_source_known;
alter table customers
  add constraint customers_phone_source_known
  check (
    phone_source is null
    or phone_source in (
      'homeowner_at_door',
      'homeowner_by_phone',
      'homeowner_in_writing',
      'public_record',
      'third_party_lookup',
      'unknown'
    )
  );

comment on column customers.phone_source is
  'How this number was obtained. Only the three homeowner_* values are the '
  'person handing over their own number; everything else is somebody else '
  'telling us about them, however accurate. Null means the row predates the '
  'column, not that the source was trustworthy.';

create index if not exists customers_phone_source_idx
  on customers (organization_id, phone_source) where phone_source is not null;
