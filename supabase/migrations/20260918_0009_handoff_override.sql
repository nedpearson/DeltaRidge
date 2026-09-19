-- -----------------------------------------------------------------------------
-- 0009 — Record deliberate completeness overrides.
--
-- The completeness engine used to hard-gate completion. In the field that is
-- the wrong trade: a rep who cannot get on the roof, or whose homeowner walks
-- off mid-visit, still has to be able to close the visit out. Blocking them
-- does not produce the missing photo, it produces an inspection that never gets
-- recorded at all.
--
-- So nothing is mandatory any more. What replaces the gate is accountability:
-- the rep confirms what is missing, and that decision travels with the
-- inspection so the office sees the gaps before pricing rather than after.
-- -----------------------------------------------------------------------------

alter table inspections
  add column if not exists overridden_issue_codes text[] not null default '{}',
  add column if not exists override_note text;

comment on column inspections.overridden_issue_codes is
  'Completeness issue codes the inspector knowingly finished without. Empty means nothing was skipped.';
comment on column inspections.override_note is
  'Optional reason the inspector gave for finishing with outstanding items.';

-- Cheap partial index: the office view that matters is "show me the ones with
-- gaps", which is the minority of rows.
create index if not exists inspections_with_overrides_idx
  on inspections (organization_id)
  where cardinality(overridden_issue_codes) > 0;
