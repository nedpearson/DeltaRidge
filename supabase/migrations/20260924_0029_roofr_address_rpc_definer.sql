-- =============================================================================
-- 0029  Let the webhook actually reach the address normaliser
-- =============================================================================
-- 0028 exposed public.roofr_normalize_address as SECURITY INVOKER, which looked
-- like the conservative choice and was in fact a broken one: `service_role` has
-- no USAGE on the `app` schema, so the wrapper could never call the function it
-- wraps. Every inbound Roofr event fell through to "unmatched" — with a 200, a
-- recorded event and an honest reason, which is why this was visible rather
-- than silent, but still wrong.
--
-- Found by posting a real event at the deployed endpoint with an address that
-- is verifiably in the properties table, and getting matched=unmatched back.
-- Nothing in the unit tests could have caught it; it is a grant, not a branch.
--
-- The fix is SECURITY DEFINER on this one function rather than
-- `grant usage on schema app to service_role`, which would hand the service
-- role every helper in that schema to solve a problem with one of them.
--
-- Safe as definer: it takes two text arguments, calls one immutable pure
-- function, touches no table, and returns a string. There is no row it could
-- expose and no statement a caller could steer. search_path is pinned so the
-- `app.` reference cannot be shadowed.
--
-- Rollback: re-run 0028 (restores the invoker version, and the bug).
-- =============================================================================

create or replace function public.roofr_normalize_address(raw_address text, raw_postal text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.normalize_address(raw_address || ' ' || coalesce(raw_postal, ''));
$$;

revoke all on function public.roofr_normalize_address(text, text) from public, anon, authenticated;
grant execute on function public.roofr_normalize_address(text, text) to service_role;

comment on function public.roofr_normalize_address is
  'SECURITY DEFINER so the inbound webhook, which runs as service_role and has '
  'no USAGE on the app schema, can normalise an address with the same rules as '
  'the generated column it must match. Pure: no tables, no rows, no statement '
  'a caller could steer.';
