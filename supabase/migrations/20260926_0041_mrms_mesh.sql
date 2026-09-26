-- =============================================================================
-- 0041  NOAA MRMS MESH grid ingestion
-- =============================================================================
-- Public NOAA/NSSL radar-estimated hail data. MESH is a radar-derived estimate,
-- not an observation of hail on the ground. Values are stored in inches after
-- converting the GRIB2 base unit (millimetres).
--
-- The worker stores only cells at/above its configured floor. A missing cell is
-- therefore NOT proof that no hail occurred; the ingest-run record is what tells
-- the UI whether a product was actually processed for a time.
-- =============================================================================

insert into storm_providers (
  id, display_name, geometry_storage_allowed, attribution, notes
)
values (
  'mrms',
  'NOAA MRMS MESH',
  true,
  'Source: NOAA/NSSL Multi-Radar Multi-Sensor (MRMS) MESH',
  'Public NOAA radar-derived Maximum Estimated Size of Hail. MESH is an estimate, not a ground report.'
)
on conflict (id) do update set
  display_name = excluded.display_name,
  geometry_storage_allowed = excluded.geometry_storage_allowed,
  attribution = excluded.attribution,
  notes = excluded.notes;

create table if not exists mrms_ingest_runs (
  id                  uuid primary key default gen_random_uuid(),
  product             text not null,
  valid_at            timestamptz not null,
  source_url          text not null,
  source_file         text,
  source_checksum     text,
  status              text not null check (status in ('started','success','failed')),
  minimum_inches      numeric(4,2) not null,
  bbox_west           double precision,
  bbox_south          double precision,
  bbox_east           double precision,
  bbox_north          double precision,
  cells_stored        integer not null default 0,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  error_summary       text,
  unique (product, valid_at)
);

create index if not exists mrms_ingest_runs_latest
  on mrms_ingest_runs (product, valid_at desc);

create table if not exists mrms_mesh_cells (
  id                  bigserial primary key,
  run_id              uuid not null references mrms_ingest_runs(id) on delete cascade,
  product             text not null,
  valid_at            timestamptz not null,
  grid_key            text not null,
  mesh_inches         numeric(5,2) not null check (mesh_inches >= 0),
  location            geography(Point, 4326) not null,
  ingested_at         timestamptz not null default now(),
  unique (product, valid_at, grid_key)
);

create index if not exists mrms_mesh_cells_location_gix
  on mrms_mesh_cells using gist (location);
create index if not exists mrms_mesh_cells_time_size
  on mrms_mesh_cells (valid_at desc, mesh_inches desc);

alter table mrms_ingest_runs enable row level security;
alter table mrms_mesh_cells enable row level security;

create policy mrms_ingest_runs_authenticated_read
  on mrms_ingest_runs for select to authenticated using (true);

create policy mrms_mesh_cells_authenticated_read
  on mrms_mesh_cells for select to authenticated using (true);

create or replace function public.ingest_mrms_mesh_cells(
  p_run_id uuid,
  p_product text,
  p_valid_at timestamptz,
  p_cells jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  written integer := 0;
begin
  if jsonb_typeof(p_cells) <> 'array' then
    raise exception 'p_cells must be a JSON array' using errcode = '22023';
  end if;

  insert into mrms_mesh_cells (
    run_id,
    product,
    valid_at,
    grid_key,
    mesh_inches,
    location
  )
  select
    p_run_id,
    p_product,
    p_valid_at,
    item->>'grid_key',
    (item->>'mesh_inches')::numeric,
    st_setsrid(
      st_makepoint(
        (item->>'longitude')::double precision,
        (item->>'latitude')::double precision
      ),
      4326
    )::geography
  from jsonb_array_elements(p_cells) item
  where
    item ? 'grid_key'
    and item ? 'mesh_inches'
    and item ? 'latitude'
    and item ? 'longitude'
    and (item->>'latitude')::double precision between -90 and 90
    and (item->>'longitude')::double precision between -180 and 180
    and (item->>'mesh_inches')::numeric >= 0
  on conflict (product, valid_at, grid_key) do update
    set
      run_id = excluded.run_id,
      mesh_inches = greatest(mrms_mesh_cells.mesh_inches, excluded.mesh_inches),
      location = excluded.location,
      ingested_at = now();

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.ingest_mrms_mesh_cells(uuid,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_mrms_mesh_cells(uuid,text,timestamptz,jsonb)
  to service_role;

create or replace function public.search_mrms_mesh(
  p_west double precision,
  p_south double precision,
  p_east double precision,
  p_north double precision,
  p_from timestamptz,
  p_to timestamptz,
  p_min_inches numeric default 1.0,
  p_limit integer default 10000
)
returns table (
  product text,
  valid_at timestamptz,
  grid_key text,
  mesh_inches numeric,
  latitude double precision,
  longitude double precision
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    c.product,
    c.valid_at,
    c.grid_key,
    c.mesh_inches,
    st_y(c.location::geometry) as latitude,
    st_x(c.location::geometry) as longitude
  from mrms_mesh_cells c
  where c.valid_at >= p_from
    and c.valid_at <= p_to
    and c.mesh_inches >= p_min_inches
    and st_intersects(
      c.location,
      st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::geography
    )
  order by c.valid_at desc, c.mesh_inches desc
  limit least(greatest(p_limit, 1), 25000);
$$;

grant execute on function public.search_mrms_mesh(
  double precision,double precision,double precision,double precision,
  timestamptz,timestamptz,numeric,integer
) to authenticated;

create or replace view public.mrms_health
with (security_invoker = true)
as
select
  product,
  max(valid_at) filter (where status = 'success') as latest_success_valid_at,
  max(completed_at) filter (where status = 'success') as latest_success_at,
  max(completed_at) filter (where status = 'failed') as latest_failure_at,
  count(*) filter (where status = 'success') as successful_runs,
  count(*) filter (where status = 'failed') as failed_runs,
  min(valid_at) filter (where status = 'success') as coverage_started_at
from mrms_ingest_runs
group by product;

grant select on public.mrms_health to authenticated;

comment on table mrms_mesh_cells is
  'Thresholded NOAA MRMS MESH grid cells. Radar-derived estimate only; never a ground-hail observation.';
comment on view public.mrms_health is
  'Observed MRMS worker ingestion history. coverage_started_at is the earliest successful run retained, not a promise of historical completeness before that date.';
