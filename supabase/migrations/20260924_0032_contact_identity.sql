-- =============================================================================
-- 0032  Canonical customer contact methods for Lead 360
-- =============================================================================
-- A customer can have several phones and emails. The old customers columns stay
-- for compatibility with existing sync/Roofr paths; this table is the canonical
-- history-aware list used by Lead 360.
--
-- Human knowledge must outrank provider refreshes. A provider can append a new
-- candidate, but it must not silently reset a number a rep marked wrong,
-- disconnected, or do-not-contact.
-- =============================================================================

create table if not exists customer_contact_methods (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  customer_id         uuid not null references customers (id) on delete cascade,
  channel             text not null check (channel in ('phone', 'email')),
  value                text not null,
  value_normalized     text generated always as (
    case
      when channel = 'phone'
        then nullif(regexp_replace(value, '\D', '', 'g'), '')
      else nullif(lower(trim(value)), '')
    end
  ) stored,
  label                text not null default 'other'
    check (label in ('primary', 'secondary', 'other')),
  status               text not null default 'unconfirmed'
    check (status in ('unconfirmed', 'confirmed', 'wrong_number', 'disconnected', 'do_not_contact')),
  kind                 text not null default 'unknown',
  source               text not null,
  provider_confidence  text check (provider_confidence in ('high', 'medium', 'low')),
  retrieved_at         timestamptz,
  entered_by           uuid references auth.users (id) on delete set null,
  entered_at           timestamptz not null default now(),
  status_set_by        uuid references auth.users (id) on delete set null,
  status_set_at        timestamptz,
  deleted_at           timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  constraint contact_method_value_not_blank check (length(trim(value)) > 0)
);

create unique index if not exists customer_contact_methods_unique_active
  on customer_contact_methods (organization_id, customer_id, channel, value_normalized)
  where deleted_at is null and value_normalized is not null;

create index if not exists customer_contact_methods_customer
  on customer_contact_methods (customer_id, channel)
  where deleted_at is null;

create index if not exists customer_contact_methods_org_status
  on customer_contact_methods (organization_id, status)
  where deleted_at is null;

-- Backfill the compatibility columns once. ON CONFLICT lets this migration be
-- replayed safely in environments where some rows were already promoted.
insert into customer_contact_methods
  (organization_id, customer_id, channel, value, label, status, kind, source, entered_at)
select organization_id, id, 'phone', primary_phone, 'primary', 'unconfirmed', 'unknown',
       'legacy_customer_primary_phone', created_at
from customers
where primary_phone is not null and trim(primary_phone) <> ''
on conflict do nothing;

insert into customer_contact_methods
  (organization_id, customer_id, channel, value, label, status, kind, source, entered_at)
select organization_id, id, 'phone', secondary_phone, 'secondary', 'unconfirmed', 'unknown',
       'legacy_customer_secondary_phone', created_at
from customers
where secondary_phone is not null and trim(secondary_phone) <> ''
on conflict do nothing;

insert into customer_contact_methods
  (organization_id, customer_id, channel, value, label, status, kind, source, entered_at)
select organization_id, id, 'email', email, 'primary', 'unconfirmed', 'unknown',
       'legacy_customer_email', created_at
from customers
where email is not null and trim(email) <> ''
on conflict do nothing;

alter table customer_contact_methods enable row level security;

create policy customer_contact_methods_org_access
  on customer_contact_methods
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

-- Lead 360 reads methods by the stable local lead id used by every device.
create or replace view lead_contact_methods
with (security_invoker = true)
as
select
  l.organization_id,
  l.client_id as lead_client_id,
  l.id as lead_id,
  c.id as customer_id,
  c.first_name,
  c.last_name,
  c.company_name,
  m.id as method_id,
  m.channel,
  m.value,
  m.label,
  m.status,
  m.kind,
  m.source,
  m.provider_confidence,
  m.retrieved_at,
  m.entered_at,
  m.status_set_at
from leads l
left join customers c on c.id = l.customer_id and c.deleted_at is null
left join customer_contact_methods m
  on m.customer_id = c.id
 and m.organization_id = l.organization_id
 and m.deleted_at is null
where l.deleted_at is null;

grant select on lead_contact_methods to authenticated;

comment on table customer_contact_methods is
  'Canonical multi-phone/multi-email customer contact list. Provider refreshes append candidates; human-set status is preserved.';
comment on column customer_contact_methods.status is
  'Human verification state. do_not_contact is terminal in ordinary field workflows and must not be reset by provider refresh.';
