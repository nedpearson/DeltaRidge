-- =============================================================================
-- 0039  Retire Mapbox as an active Delta Ridge integration
-- =============================================================================
-- Historical schemas allowed provider='mapbox'. Delta Ridge now uses EagleView
-- for in-app aerial mapping/imagery. Preserve any historical rows for audit
-- provenance, but reject new/updated Mapbox provider records at the database
-- boundary so a future client cannot silently re-enable it.
-- =============================================================================

create or replace function app.reject_retired_mapbox_provider()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if lower(coalesce(new.provider, '')) = 'mapbox' then
    raise exception 'Mapbox is retired. Delta Ridge in-app mapping uses EagleView.';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_mapbox_imagery_capture on imagery_captures;
create trigger reject_mapbox_imagery_capture
  before insert or update of provider on imagery_captures
  for each row execute function app.reject_retired_mapbox_provider();

drop trigger if exists reject_mapbox_imagery_request on imagery_requests;
create trigger reject_mapbox_imagery_request
  before insert or update of provider on imagery_requests
  for each row execute function app.reject_retired_mapbox_provider();

drop trigger if exists reject_mapbox_integration_connection on integration_connections;
create trigger reject_mapbox_integration_connection
  before insert or update of provider on integration_connections
  for each row execute function app.reject_retired_mapbox_provider();

comment on function app.reject_retired_mapbox_provider() is
  'Prevents new Mapbox integration/imagery records. Historical rows remain readable for audit provenance; active in-app mapping is EagleView.';
