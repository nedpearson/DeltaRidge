-- =============================================================================
-- 0035  Route coverage is not door coverage
-- =============================================================================
-- The distinction this function exists to make, and the reason it is a hard
-- rule rather than a nicety:
--
--   ROUTE COVERAGE - the trail went past this house.
--   DOOR COVERAGE  - somebody recorded an outcome at this house.
--
-- Treating the first as the second credits a rep for driving down a street,
-- which is the single easiest number in this product to game and the one a
-- manager would most reasonably believe. `manager_route_rows` and
-- route-stats.ts already refuse that; this refuses it at the neighbourhood
-- level too.
--
-- What it is FOR is the gap between them. "You went past 64 doors in Quail
-- Ridge and knocked 12" is the sentence that tells somebody where to send the
-- team tomorrow. Neither number alone says it.
--
-- PASSED IS NOT VISITED. A door within p_radius_m of a recorded fix is a door
-- the rep went past. It is never evidence anybody knocked, and nothing
-- downstream may present it as a visit, an attempt, or contact. It answers
-- only "was this house available on the street they actually walked".
--
-- WHY A FUNCTION AND NOT A VIEW A CLIENT JOINS
--
-- 0021 made a deliberate choice: the full trail is read one route at a time,
-- because handing every GPS point of everybody's week to a browser to draw a
-- list is a surveillance feature wearing a dashboard's clothes. Computing
-- coverage in the client would require exactly that download. So the join
-- happens here and only AGGREGATES leave - counts per subdivision, never a
-- position. This is the more private of the two designs, not the more
-- convenient one.
--
-- SECURITY INVOKER, so every RLS policy that governs route_points, activities
-- and properties governs this too. A rep calling it sees their own routes; a
-- manager sees the organisation's; nobody gains a row they could not already
-- read. The organisation is also passed explicitly, because a user who belongs
-- to two organisations must not get one number spanning both.
-- =============================================================================

create or replace function public.route_coverage(
  p_org        uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_radius_m   double precision default 45
)
returns table (
  subdivision      text,
  doors_available  integer,
  doors_passed     integer,
  doors_knocked    integer,
  appointments     integer
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with pts as (
    select rp.location
    from route_points rp
    join route_sessions s on s.id = rp.route_session_id
    where rp.organization_id = p_org
      and rp.recorded_at >= p_from
      and rp.recorded_at <= p_to
  ),
  doors as (
    select
      p.id,
      coalesce(nullif(btrim(p.subdivision), ''), 'Unnamed') as subdivision,
      p.location
    from properties p
    where p.organization_id = p_org
      and p.location is not null
      and p.deleted_at is null
  ),
  -- The trail went past. NOT a visit; see the header.
  passed as (
    select d.id, d.subdivision
    from doors d
    where exists (
      select 1 from pts
      where st_dwithin(pts.location, d.location, p_radius_m)
    )
  ),
  -- Somebody recorded an outcome. `appointment` is included because an
  -- appointment-set knock is relabelled on the way to the server, and dropping
  -- it here would lose the best door of the day - the same trap recap.ts hit.
  knocked as (
    select distinct a.property_id as id
    from activities a
    where a.organization_id = p_org
      and a.property_id is not null
      and a.activity_type in ('door_knock', 'appointment')
      and a.occurred_at >= p_from
      and a.occurred_at <= p_to
  ),
  booked as (
    select distinct a.property_id as id
    from activities a
    where a.organization_id = p_org
      and a.property_id is not null
      and a.activity_type = 'appointment'
      and a.occurred_at >= p_from
      and a.occurred_at <= p_to
  )
  select
    d.subdivision,
    count(*)::integer                                             as doors_available,
    count(*) filter (where p.id is not null)::integer              as doors_passed,
    count(*) filter (where k.id is not null)::integer              as doors_knocked,
    count(*) filter (where b.id is not null)::integer              as appointments
  from doors d
  left join passed  p on p.id = d.id
  left join knocked k on k.id = d.id
  left join booked  b on b.id = d.id
  group by d.subdivision
  order by d.subdivision;
$$;

comment on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) is
  'Per-subdivision coverage for a window. doors_passed means the recorded trail '
  'came within p_radius_m of the house and is NOT evidence of a visit; '
  'doors_knocked means an outcome was recorded there. The two must never be '
  'presented as the same thing. Returns aggregates only - no position ever '
  'leaves this function. SECURITY INVOKER, so RLS decides what is counted.';

-- Anonymous callers have no business here; this reads where people walked.
--
-- FROM PUBLIC, not from anon. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and anon inherits it there - so `revoke ... from anon`
-- succeeds, changes nothing, and leaves anon able to call it. Verified the
-- hard way: after the first revoke, has_function_privilege('anon', ...) was
-- still true. This is the same silent-no-op shape as 0033, where a revoke of
-- grants made by supabase_admin reported success and did nothing. A revoke
-- that returns without error has NOT necessarily removed anything; the only
-- proof is reading the ACL back.
--
-- It would have been harmless here - the function is SECURITY INVOKER, so anon
-- has no rows to see either way - and it is fixed anyway, because "the other
-- lock held" is not a reason to leave a door open.
revoke execute on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) from public;
grant execute on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) to authenticated;
