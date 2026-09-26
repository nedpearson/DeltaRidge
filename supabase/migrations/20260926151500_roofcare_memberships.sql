-- =============================================================================
-- 0041 RoofCare Memberships
-- =============================================================================
-- Phase 3: Converting the installed customer base into predictable recurring 
-- revenue. This establishes the Membership engine.
--
-- A membership is a relationship between a Customer and a Property under a 
-- specific Tier.
-- =============================================================================

create type membership_tier as enum ('standard', 'premium', 'elite');
create type membership_status as enum ('active', 'past_due', 'canceled', 'pending');
create type membership_billing_interval as enum ('monthly', 'annual');

create table roofcare_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  customer_id     uuid not null references customers (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  
  tier            membership_tier not null default 'standard',
  status          membership_status not null default 'pending',
  billing_interval membership_billing_interval not null default 'annual',
  
  -- The price the customer locked in at, to grandfather early adopters
  locked_price    numeric(10, 2) not null,
  
  started_at      timestamptz,
  renews_at       timestamptz,
  canceled_at     timestamptz,
  
  notes           text,
  
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  
  unique (customer_id, property_id)
);

create index roofcare_memberships_org_idx on roofcare_memberships (organization_id);
create index roofcare_memberships_status_idx on roofcare_memberships (status);
create index roofcare_memberships_renews_at_idx on roofcare_memberships (renews_at);

-- =============================================================================
-- RoofCare Service History / Fulfillment
-- =============================================================================
-- Tracks the annual inspections, priority storm responses, and other deliverables
-- fulfilled under the membership.
-- =============================================================================

create type roofcare_service_type as enum ('annual_inspection', 'post_storm_priority', 'gutter_cleaning', 'minor_repair');
create type roofcare_service_status as enum ('scheduled', 'completed', 'canceled');

create table roofcare_services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  membership_id   uuid not null references roofcare_memberships (id) on delete cascade,
  
  service_type    roofcare_service_type not null,
  status          roofcare_service_status not null default 'scheduled',
  
  scheduled_for   timestamptz not null,
  completed_at    timestamptz,
  
  inspection_id   uuid references inspections (id) on delete set null,
  
  notes           text,
  
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  assigned_to     uuid references auth.users (id) on delete set null
);

create index roofcare_services_org_idx on roofcare_services (organization_id);
create index roofcare_services_membership_idx on roofcare_services (membership_id);

-- =============================================================================
-- RLS Policies
-- =============================================================================

alter table roofcare_memberships enable row level security;
alter table roofcare_services enable row level security;

create policy roofcare_memberships_read on roofcare_memberships
  for select using (organization_id in (select app.current_org_ids()));
create policy roofcare_memberships_write on roofcare_memberships
  for all using (organization_id in (select app.current_org_ids()));

create policy roofcare_services_read on roofcare_services
  for select using (organization_id in (select app.current_org_ids()));
create policy roofcare_services_write on roofcare_services
  for all using (organization_id in (select app.current_org_ids()));

-- Trigger to touch updated_at
create trigger roofcare_memberships_touch
  before update on roofcare_memberships
  for each row execute function app.touch_updated_at();

create trigger roofcare_services_touch
  before update on roofcare_services
  for each row execute function app.touch_updated_at();
