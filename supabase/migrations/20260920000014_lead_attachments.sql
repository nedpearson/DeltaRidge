-- =============================================================================
-- 0014  Voice notes and photos captured against a LEAD
-- =============================================================================
-- Deliberately a separate table from `photos` and `voice_notes`, which belong
-- to an inspection.
--
-- An inspection photo is evidence. It is taken against a named category, it is
-- checked for quality, it goes into the package an adjuster reads, and the
-- completeness score depends on it. A lead photo is the rep's own memory: the
-- gate code, the dog, a business card, the stain on a ceiling the homeowner
-- pointed at from the doorway.
--
-- Filing them in one table would put unvetted driveway snapshots into the
-- evidence package, and would make the documentation score answerable to
-- photos nobody meant as documentation. Keeping them apart costs one table and
-- removes a whole category of mistake.
--
-- Storage reuses the `inspection-photos` bucket. Its policy checks only that
-- the second path segment is an organization the caller belongs to, so
-- `organization/<org>/leads/...` is covered by the same rule with no new
-- policy to keep in step.
-- =============================================================================

create table lead_attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  -- Device-generated, so a retried upload updates one row instead of creating
  -- a second copy of the same recording.
  client_id        uuid not null default gen_random_uuid(),
  lead_id          uuid references leads (id) on delete cascade,
  activity_id      uuid references activities (id) on delete set null,
  captured_by      uuid references auth.users (id) on delete set null,
  kind             text not null,
  storage_path     text not null,
  byte_size        integer not null,
  duration_seconds integer,
  width            integer,
  height           integer,
  -- Present only if something actually transcribed it. Never a placeholder:
  -- an empty transcript must not read as "nothing was said".
  transcript       text,
  captured_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint lead_attachments_kind check (kind in ('voice', 'photo')),
  constraint lead_attachments_org_client_unique unique (organization_id, client_id),
  constraint lead_attachments_voice_has_duration check (
    kind <> 'voice' or duration_seconds is not null
  )
);

create index on lead_attachments (organization_id, lead_id, captured_at desc);
create index on lead_attachments (activity_id);

alter table lead_attachments enable row level security;
create policy lead_attachments_org_access on lead_attachments
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

comment on table lead_attachments is
  'Voice notes and photos a rep captured while working a lead. NOT inspection '
  'evidence - see photos and voice_notes for that.';
