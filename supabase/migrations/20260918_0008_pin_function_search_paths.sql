-- -----------------------------------------------------------------------------
-- 0008 — Pin search_path on the remaining helper functions.
--
-- The SECURITY DEFINER functions already pinned theirs (see 0002). These five
-- are plain trigger/helper functions, so the exposure is smaller, but an
-- unpinned search_path still lets a caller-supplied schema shadow an unqualified
-- name inside the body. Supabase's database linter flags all five
-- (0011_function_search_path_mutable) and it is a one-line fix each.
--
-- ALTER FUNCTION ... SET is used rather than CREATE OR REPLACE on purpose:
-- app.normalize_address backs a generated column on `properties`, and leaving
-- the body untouched keeps that dependency from being revalidated.
-- -----------------------------------------------------------------------------

alter function app.touch_updated_at()           set search_path = public, pg_catalog;
alter function app.normalize_address(text)      set search_path = public, pg_catalog;
alter function app.bump_lead_activity()         set search_path = public, pg_catalog;
alter function app.satisfy_checklist_on_photo() set search_path = public, pg_catalog;
alter function app.enforce_geometry_licence()   set search_path = public, pg_catalog;
