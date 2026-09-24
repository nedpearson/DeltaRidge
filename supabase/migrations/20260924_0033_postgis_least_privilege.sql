-- =============================================================================
-- 0033  Stop anon being able to break every coordinate transform in the app
-- =============================================================================
-- The same blanket default privileges that 0032 cleaned off our own views also
-- landed on PostGIS's own objects, and one of them matters.
--
-- public.spatial_ref_sys is the EPSG lookup table: the thing ST_Transform reads
-- to know what SRID 4326 means. It had SELECT, INSERT, UPDATE, DELETE and
-- TRUNCATE granted to `anon`, and RLS is not enabled on it (it cannot sensibly
-- be — it is extension-owned static reference data).
--
-- So, holding only the public anon key:
--
--     DELETE /rest/v1/spatial_ref_sys?srid=eq.4326
--
-- and every geometry operation in the product starts failing. No data is
-- stolen; the app simply stops being able to do geography. That is a denial of
-- service against a roofing crew's door list, reachable by anyone who views
-- source on the deployed bundle.
--
-- SELECT stays: PostGIS needs to read it, and EPSG definitions are public
-- reference data with nothing of ours in them. Only the writes go.
--
-- Also here: st_estimatedextent is a SECURITY DEFINER C function that PostGIS
-- exposes, which Supabase's linter flags because it is reachable at
-- /rest/v1/rpc/st_estimatedextent by anon. It reads planner statistics to
-- return the bounding box of a geometry column — a mild disclosure of where
-- our data sits geographically. Nothing in src/ or supabase/ calls it
-- (verified), so EXECUTE comes off both browser roles.
--
-- NOT done here, deliberately: moving postgis, pg_trgm and btree_gist out of
-- the public schema, which the linter also suggests. That is a real
-- correctness improvement in the abstract and a genuine way to break a
-- production database on a Thursday afternoon — every existing index,
-- function signature and migration would need its search_path revisited. It
-- stays on the list, not in this migration.
-- =============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.spatial_ref_sys from anon, authenticated;

grant select on public.spatial_ref_sys to anon, authenticated;

revoke execute on function public.st_estimatedextent(text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean) from anon, authenticated;
