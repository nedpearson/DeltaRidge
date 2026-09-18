-- =============================================================================
-- 0003  CRM core: customers, properties, leads, activities, appointments
-- =============================================================================
-- CUSTOMER and PROPERTY are deliberately separate entities joined by
-- property_owners. One customer can own several properties; a property changes
-- hands over the years. Collapsing them into one "contact" row is the mistake
-- that makes a roofing CRM useless at year three, when you knock a door you
-- last sold in 2019 and the record says the wrong name.
-- =============================================================================

create type lead_status as enum (
  'untouched', 'target', 'attempted', 'no_answer', 'spoke', 'interested',
  'inspection_requested', 'appointment', 'inspected', 'proposal_pending',
  'sold', 'lost', 'not_interested', 'do_not_contact', 'existing_customer'
);

create type property_type as enum ('residential', 'multi_family', 'commercial', 'other');
create type roof_material as enum (
  'asphalt_shingle', 'architectural_shingle', 'metal', 'tile', 'slate',
  'flat_tpo', 'flat_epdm', 'flat_modified_bitumen', 'wood_shake', 'unknown'
);

create table customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  first_name      text,
  last_name       text,
  company_name    text,
  primary_phone   text,
  secondary_phone text,
  email           text,
  mailing_address text,
  notes           text,
  -- Normalised contact keys for duplicate detection. Digits only for phone so
  -- (225) 573-4442 and 2255734442 collide as they should.
  phone_digits    text generated always as (
                    nullif(regexp_replace(coalesce(primary_phone, ''), '\D', '', 'g'), '')
                  ) stored,
  email_lower     text generated always as (nullif(lower(trim(coalesce(email, ''))), '')) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,
  constraint customers_have_a_name check (
    coalesce(first_name, last_name, company_name) is not null
  )
);

create index on customers (organization_id) where deleted_at is null;
create index on customers (organization_id, phone_digits) where phone_digits is not null;
create index on customers (organization_id, email_lower) where email_lower is not null;
create index customers_name_trgm on customers
  using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

create table properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  address_line1    text not null,
  address_line2    text,
  city             text,
  state            text default 'LA',
  postal_code      text,
  parish           text,             -- Louisiana's county equivalent
  location         geography(Point, 4326),
  property_type    property_type not null default 'residential',
  stories          smallint,
  roof_material    roof_material not null default 'unknown',
  -- Only ever set from an authoritative source or a homeowner statement.
  -- roof_age_source records which, so nobody mistakes a guess for a fact.
  roof_age_years   smallint,
  roof_age_source  text,
  square_footage   integer,
  access_notes     text,             -- gate codes, dogs, steep pitch, low wires
  notes            text,
  normalized_address text generated always as (
                     app.normalize_address(
                       address_line1 || ' ' || coalesce(postal_code, '')
                     )
                   ) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  constraint properties_stories_sane check (stories is null or stories between 1 and 10),
  constraint properties_roof_age_sane check (roof_age_years is null or roof_age_years between 0 and 120)
);

create index properties_location_gix on properties using gist (location);
create index on properties (organization_id) where deleted_at is null;
-- Duplicate protection: one normalised address per org.
create unique index properties_unique_address on properties (organization_id, normalized_address)
  where deleted_at is null and normalized_address is not null;
create index properties_address_trgm on properties using gin (address_line1 gin_trgm_ops);

create table property_owners (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  is_current  boolean not null default true,
  owned_from  date,
  owned_until date,
  created_at  timestamptz not null default now(),
  unique (property_id, customer_id)
);

create index on property_owners (customer_id);
create index on property_owners (property_id) where is_current;

create table lead_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  category        text,   -- canvassing | referral | web | storm | import | office
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  description     text,
  -- Canvassing zone, if the campaign is geographic.
  area            geography(MultiPolygon, 4326),
  starts_on       date,
  ends_on         date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);

create index campaigns_area_gix on campaigns using gist (area);
create index on campaigns (organization_id) where is_active;

create table leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  property_id      uuid not null references properties (id) on delete cascade,
  customer_id      uuid references customers (id) on delete set null,
  assigned_to      uuid references auth.users (id) on delete set null,
  status           lead_status not null default 'untouched',
  lead_source_id   uuid references lead_sources (id) on delete set null,
  campaign_id      uuid references campaigns (id) on delete set null,
  -- Opportunity score is intentionally nullable. A null score means "we have no
  -- basis for one yet", which is honest. It is never defaulted to a number.
  opportunity_score smallint,
  score_computed_at timestamptz,
  first_contacted_at timestamptz,
  last_activity_at timestamptz,
  next_action_at   timestamptz,
  next_action_note text,
  lost_reason      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  constraint leads_score_range check (opportunity_score is null or opportunity_score between 0 and 100)
);

create index on leads (organization_id, status) where deleted_at is null;
create index on leads (organization_id, assigned_to) where deleted_at is null;
create index on leads (organization_id, next_action_at) where deleted_at is null and next_action_at is not null;
create index on leads (property_id);
create unique index leads_one_open_per_property on leads (property_id)
  where deleted_at is null and status not in ('sold', 'lost', 'not_interested');

create table activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid references leads (id) on delete cascade,
  property_id     uuid references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  user_id         uuid references auth.users (id) on delete set null,
  activity_type   text not null,  -- door_knock | call | text | email | note | status_change | inspection | handoff
  outcome         text,
  body            text,
  -- Where the rep actually was when this was recorded. Useful for verifying
  -- canvassing coverage; deliberately coarse and never used punitively.
  recorded_at_location geography(Point, 4326),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb
);

create index on activities (organization_id, occurred_at desc);
create index on activities (lead_id, occurred_at desc);
create index on activities (property_id, occurred_at desc);

create table appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid references leads (id) on delete set null,
  property_id     uuid not null references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  assigned_to     uuid references auth.users (id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz,
  status          text not null default 'scheduled',  -- scheduled | confirmed | completed | no_show | cancelled
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  constraint appointments_end_after_start check (scheduled_end is null or scheduled_end > scheduled_start)
);

create index on appointments (organization_id, scheduled_start);
create index on appointments (assigned_to, scheduled_start);

-- Keep leads.last_activity_at current without the client having to remember.
create or replace function app.bump_lead_activity()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is not null then
    update leads
       set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
     where id = new.lead_id;
  end if;
  return new;
end;
$$;

create trigger activities_bump_lead
  after insert on activities
  for each row execute function app.bump_lead_activity();

create trigger touch_customers before update on customers for each row execute function app.touch_updated_at();
create trigger touch_properties before update on properties for each row execute function app.touch_updated_at();
create trigger touch_campaigns before update on campaigns for each row execute function app.touch_updated_at();
create trigger touch_leads before update on leads for each row execute function app.touch_updated_at();
create trigger touch_appointments before update on appointments for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Policies: org members read and write within their own organization.
-- Role-based narrowing (e.g. restricting a salesperson to their own leads) is
-- deliberately NOT applied yet — Delta Ridge is one rep today and premature
-- row-level narrowing makes the manager dashboard impossible to build. Add it
-- when there is a second rep and a reason.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'properties', 'lead_sources', 'campaigns',
    'leads', 'activities', 'appointments'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- property_owners has no organization_id of its own; it inherits via property.
alter table property_owners enable row level security;
create policy property_owners_org_access on property_owners
  for all
  using (exists (
    select 1 from properties p
    where p.id = property_owners.property_id
      and p.organization_id in (select app.current_org_ids())
  ))
  with check (exists (
    select 1 from properties p
    where p.id = property_owners.property_id
      and p.organization_id in (select app.current_org_ids())
  ));
