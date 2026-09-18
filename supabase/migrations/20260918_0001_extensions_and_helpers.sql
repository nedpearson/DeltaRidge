-- =============================================================================
-- 0001  Extensions, shared helpers, and conventions
-- =============================================================================
-- Conventions used across every migration:
--   * UUID primary keys (gen_random_uuid) so records can be created offline on
--     a phone and synced later without key collisions.
--   * created_at / updated_at / created_by on anything a human authors.
--   * Soft delete (deleted_at) wherever audit history matters. A lead that was
--     marked "do not contact" must never vanish from the record.
--   * Geography(Point, 4326) for locations so distance math is in metres and
--     correct over a parish-sized area without projection juggling.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "postgis";
create extension if not exists "pg_trgm";      -- fuzzy address matching / dedupe
create extension if not exists "btree_gist";

-- Application-owned schema for helper functions, kept out of `public` so the
-- generated API surface stays clean.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'BEFORE UPDATE trigger: maintains updated_at. Attach to every mutable table.';

-- -----------------------------------------------------------------------------
-- Address normalisation, used for duplicate detection.
-- Deliberately crude and deterministic: lowercase, strip punctuation, collapse
-- whitespace, and fold the most common Louisiana street-type abbreviations.
-- This is a *matching* aid, not a mailing-address authority.
-- -----------------------------------------------------------------------------
create or replace function app.normalize_address(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(raw, '')), '[.,#]', '', 'g'),
        '\y(street|str)\y', 'st', 'g'
      ),
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;

comment on function app.normalize_address is
  'Deterministic address normaliser for duplicate detection only. Not a USPS-grade normaliser.';
