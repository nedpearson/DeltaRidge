-- =============================================================================
-- Marketing & Contact Suppression System
-- =============================================================================

create table if not exists contact_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  customer_id uuid references customers(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  
  -- The core suppression flags
  do_not_call boolean default false,
  do_not_text boolean default false,
  do_not_email boolean default false,
  do_not_mail boolean default false,
  customer_only_communication boolean default false,
  
  -- Marketing consent tracking
  marketing_consent boolean default true,
  consent_source text, -- e.g., 'web_form', 'verbal', 'contract'
  consent_timestamp timestamptz,
  opt_out_timestamp timestamptz,
  suppression_reason text, -- e.g., 'requested_removal', 'hostile', 'competitor'
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- A preference must be tied to either a person or a property (or both)
  constraint has_target check (customer_id is not null or property_id is not null)
);

create index idx_contact_pref_customer on contact_preferences(customer_id);
create index idx_contact_pref_property on contact_preferences(property_id);

alter table contact_preferences enable row level security;
