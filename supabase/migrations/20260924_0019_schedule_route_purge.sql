-- =============================================================================
-- 0019  Actually run the retention policy
-- =============================================================================
-- `app.purge_expired_route_points()` has existed since 0017 and nothing called
-- it. A retention promise that nothing calls is not a retention policy; it is a
-- comment. Location history is the most sensitive thing this system holds, and
-- it was accumulating for ever behind a function nobody ran.
--
-- 04:17 UTC rather than on the hour: cron jobs that all fire at :00 contend
-- with everything else scheduled by habit, and nothing here is time-critical.
--
-- Verified against the live database inside a rolled-back transaction — with
-- the default 90 day window, a 200-day-old point was removed, a 2-day-old point
-- was kept, and the session itself was kept.
--
-- Rollback:
--   select cron.unschedule('purge-expired-route-points');
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-route-points',
  '17 4 * * *',
  $$select app.purge_expired_route_points();$$
);

comment on function app.purge_expired_route_points() is
  'Deletes GPS points past their organisation''s retention window. Points only; '
  'the sessions themselves are the record that work happened and are kept. '
  'Scheduled nightly at 04:17 UTC by the pg_cron job purge-expired-route-points '
  '- a retention promise nothing calls is not a retention policy.';
