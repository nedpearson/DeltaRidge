-- =============================================================================
-- 0031  Which contact-data provider this company may actually use
-- =============================================================================
-- The research behind this, 23 September 2026: BeenVerified does run a current
-- documented API, but its CONSUMER terms (updated 23 October 2025) prohibit use
-- "for professional, commercial, business ... lead-list generating ...
-- purposes". A roofing company building a call list is inside that list four
-- ways. The prohibition is on the PURPOSE, so it binds a rep typing a number in
-- by hand exactly as it binds a script fetching one.
--
-- Hence `commercial_use_confirmed`: a person has read the agreement behind the
-- credential and states that it permits commercial prospecting. No API response
-- can tell you what contract you signed, so this cannot be detected — only
-- attested, by somebody, on a date, with their name against it.
--
-- Rollback: drop table if exists contact_provider_settings cascade;
-- =============================================================================

create table if not exists contact_provider_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,

  entitlement text not null default 'none',

  /*
   * Whether a server-side credential exists. NOT the credential.
   *
   * The key itself lives in an Edge Function secret. This column exists so the
   * admin screen can say "a key is set" without the browser ever being able to
   * read one, and so there is no column anybody could be tempted to paste into.
   */
  credential_present boolean not null default false,

  commercial_use_confirmed boolean not null default false,
  commercial_use_confirmed_by uuid references auth.users (id) on delete set null,
  commercial_use_confirmed_at timestamptz,
  /** What the confirmer says permits this. A contract name or a date. */
  commercial_use_basis text,

  -- Off unless somebody chooses otherwise, knowing each call costs money.
  secondary_providers_enabled boolean not null default false,

  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint contact_provider_entitlement_known check (entitlement in (
    'none', 'consumer_subscription', 'business_api'
  )),
  -- A confirmation with nobody's name on it is not a confirmation.
  constraint contact_provider_confirmation_attributed check (
    commercial_use_confirmed = false
    or (commercial_use_confirmed_by is not null and commercial_use_confirmed_at is not null)
  )
);

comment on table contact_provider_settings is
  'Whether this organisation may use a people-search provider, and on whose '
  'authority. Holds no credential: the key is an Edge Function secret.';
comment on column contact_provider_settings.commercial_use_confirmed is
  'A person attests the agreement behind the credential permits commercial '
  'prospecting. Not detectable from any API response — only attestable.';

alter table contact_provider_settings enable row level security;

drop policy if exists contact_provider_read on contact_provider_settings;
create policy contact_provider_read on contact_provider_settings
  for select using (organization_id in (select app.current_org_ids()));

-- Deciding what data this company is entitled to use is not a rep's call.
drop policy if exists contact_provider_admin_write on contact_provider_settings;
create policy contact_provider_admin_write on contact_provider_settings
  for all
  using (app.has_org_role(organization_id, array['admin']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin']::app_role[]));

drop trigger if exists contact_provider_touch on contact_provider_settings;
create trigger contact_provider_touch
  before update on contact_provider_settings
  for each row execute function app.touch_updated_at();
