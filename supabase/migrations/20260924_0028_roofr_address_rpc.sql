-- =============================================================================
-- 0028  One address normaliser, reachable from the Edge Function
-- =============================================================================
-- properties.normalized_address is a generated column computed by
-- app.normalize_address. The inbound webhook has to normalise a Roofr address
-- the identical way or it will never match a row, and `app` is not a schema
-- PostgREST exposes.
--
-- The alternative — reimplementing the same regexes in TypeScript — is how the
-- two copies drift: somebody adds "avenue -> ave" to the SQL, the webhook keeps
-- the old rules, and inbound events quietly stop matching properties that are
-- plainly there. So this is a thin wrapper over the one real implementation,
-- not a second one.
--
-- Rollback:
--   drop function if exists public.roofr_normalize_address(text, text);
-- =============================================================================

create or replace function public.roofr_normalize_address(raw_address text, raw_postal text)
returns text
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  -- Composed exactly as properties.normalized_address is composed, including
  -- the space and the coalesce. Any difference here is a silent no-match.
  select app.normalize_address(raw_address || ' ' || coalesce(raw_postal, ''));
$$;

comment on function public.roofr_normalize_address is
  'Wrapper so the inbound Roofr webhook normalises an address with the exact '
  'same rules as the generated column it has to match against.';

revoke all on function public.roofr_normalize_address(text, text) from public, anon, authenticated;
grant execute on function public.roofr_normalize_address(text, text) to service_role;
