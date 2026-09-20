-- =============================================================================
-- Estimating core: RLS, immutability and constraint assertions
-- =============================================================================
-- Run against a database that has replayed every migration, after
-- supabase/tests/00_supabase_stub.sql. Each block asserts a claim the
-- estimator makes about itself; a failing assertion aborts the script.
--
-- The claims under test:
--   1. A salesperson cannot read cost, at the database, not just in the UI.
--   2. A salesperson CAN read scope and the selling price.
--   3. A priced estimate version cannot be rewritten after the fact.
--   4. A price cannot be edited; only superseded.
--   5. A waste override without a reason is rejected.
--   6. A margin policy that cannot be solved for a price is rejected.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'manager@dr.test'),
  ('22222222-2222-2222-2222-222222222222', 'rep@dr.test');

insert into organizations (id, name, slug)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Delta Ridge Test', 'dr-test');

insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'salesperson');

insert into price_books (id, organization_id, version, is_active)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', '2026.09', true);

insert into material_items (id, organization_id, price_book_id, category, description,
                            unit, coverage_per_unit)
  values ('cccccccc-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001',
          'shingle', 'Architectural shingle', 'BDL', 33.33);

insert into material_prices (organization_id, material_item_id, unit_cost_e4,
                             effective_from, source)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000001', 387500, '2026-07-01', 'invoice');

insert into margin_policies (id, organization_id, version, standard_margin_bps,
  target_margin_bps, floor_margin_bps, stop_margin_bps, overhead_rate_bps,
  commission_bps, is_active)
  values ('dddddddd-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'v1',
          3800, 3500, 3000, 2600, 1200, 800, true);

insert into waste_models (id, organization_id, version, base_bps, hip_valley_strip_ft,
  rake_strip_ft, steep_surcharge_bps, steep_pitch_rise, min_bps, max_bps, is_active)
  values ('eeeeeeee-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'v1',
          300, 0.75, 0.25, 200, 8, 300, 2200, true);

insert into properties (id, organization_id, address_line1, city)
  values ('ffffffff-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', '123 Main St', 'Baton Rouge');

insert into estimates (id, organization_id, property_id)
  values ('99999999-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          'ffffffff-0000-0000-0000-000000000001');

insert into estimate_versions (id, organization_id, estimate_id, version_number,
  price_book_id, priced_as_of, margin_policy_id, waste_model_id, geometry_source,
  direct_cost_cents, overhead_cents, job_cost_cents, sell_price_cents)
  values ('88888888-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          '99999999-0000-0000-0000-000000000001', 1,
          'bbbbbbbb-0000-0000-0000-000000000001', '2026-09-19',
          'dddddddd-0000-0000-0000-000000000001',
          'eeeeeeee-0000-0000-0000-000000000001', 'manual',
          880000, 105600, 985600, 1865000);

insert into estimate_items (organization_id, estimate_version_id, category, description,
  quantity_milli, unit, unit_cost_e4, cost_cents, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '88888888-0000-0000-0000-000000000001', 'material',
          'Architectural shingle', 127000, 'BDL', 387500, 492125, 'delta_ridge_standard');

grant usage on schema public to authenticated;
grant select, insert on all tables in schema public to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- 1 + 2. Cost isolation
-- -----------------------------------------------------------------------------

do $$
declare rows_seen integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

  select count(*) into rows_seen from material_prices;
  if rows_seen <> 0 then
    raise exception 'FAIL 1a: salesperson read % material price rows', rows_seen;
  end if;

  select count(*) into rows_seen from estimate_items;
  if rows_seen <> 0 then
    raise exception 'FAIL 1b: salesperson read % estimate item rows', rows_seen;
  end if;

  select count(*) into rows_seen from estimate_items_sales;
  if rows_seen <> 1 then
    raise exception 'FAIL 2a: salesperson saw % scope rows, expected 1', rows_seen;
  end if;

  select count(*) into rows_seen
    from estimate_versions_sales where sell_price_cents = 1865000;
  if rows_seen <> 1 then
    raise exception 'FAIL 2b: salesperson could not read the selling price';
  end if;
end;
$$;

do $$
declare rows_seen integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into rows_seen from material_prices;
  if rows_seen <> 1 then
    raise exception 'FAIL 1c: manager saw % material price rows, expected 1', rows_seen;
  end if;
end;
$$;

-- The cost columns must not exist on the sales views at all. A policy that
-- merely filters rows still leaks the column list.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name in ('estimate_items_sales', 'estimate_versions_sales')
      and column_name in ('unit_cost_e4', 'cost_cents', 'direct_cost_cents',
                          'overhead_cents', 'job_cost_cents')
  ) then
    raise exception 'FAIL 2c: a cost column is exposed on a sales view';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3 + 4. Nothing priced is rewritable
-- -----------------------------------------------------------------------------

do $$
begin
  begin
    update estimate_versions set sell_price_cents = 1;
    raise exception 'FAIL 3a: a priced estimate version was updated';
  exception when restrict_violation then null;
  end;

  begin
    update estimate_items set cost_cents = 1;
    raise exception 'FAIL 3b: an estimate line item was updated';
  exception when restrict_violation then null;
  end;

  begin
    delete from estimate_items;
    raise exception 'FAIL 3c: an estimate line item was deleted';
  exception when restrict_violation then null;
  end;

  begin
    update material_prices set unit_cost_e4 = 1;
    raise exception 'FAIL 4: a recorded price was edited rather than superseded';
  exception when restrict_violation then null;
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5 + 6. Constraints that keep the numbers honest
-- -----------------------------------------------------------------------------

do $$
begin
  begin
    insert into estimate_versions (organization_id, estimate_id, version_number,
      price_book_id, priced_as_of, margin_policy_id, waste_model_id,
      geometry_source, waste_override_bps)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '99999999-0000-0000-0000-000000000001', 2,
            'bbbbbbbb-0000-0000-0000-000000000001', '2026-09-19',
            'dddddddd-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000001', 'manual', 1200);
    raise exception 'FAIL 5: a waste override was accepted with no reason';
  exception when check_violation then null;
  end;

  begin
    insert into margin_policies (organization_id, version, standard_margin_bps,
      target_margin_bps, floor_margin_bps, stop_margin_bps, overhead_rate_bps,
      commission_bps)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'unsolvable',
            9600, 9000, 8000, 7000, 1200, 800);
    raise exception 'FAIL 6a: margin plus commission of 100%% or more was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into margin_policies (organization_id, version, standard_margin_bps,
      target_margin_bps, floor_margin_bps, stop_margin_bps, overhead_rate_bps)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'inverted',
            2000, 3000, 3500, 4000, 1200);
    raise exception 'FAIL 6b: a margin ladder that does not descend was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into material_prices (organization_id, material_item_id, unit_cost_e4,
      effective_from, source)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000001', 100, '2026-08-02', 'guess');
    raise exception 'FAIL 6c: a price with an invented source was accepted';
  exception when check_violation then null;
  end;
end;
$$;

\echo 'estimating.test.sql: all assertions passed'
