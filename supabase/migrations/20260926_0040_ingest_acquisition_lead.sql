-- =============================================================================
-- 0040  Atomic acquisition lead upsert
-- =============================================================================
-- Called only from the server-side acquisition Edge Function after its
-- per-organization webhook credential has been verified.
--
-- The function:
--   * deduplicates external provider deliveries;
--   * reuses the canonical property/customer when possible;
--   * never overwrites an existing phone/email with provider input;
--   * preserves phone provenance;
--   * never clears do-not-contact by creating a fresh open lead.
-- =============================================================================

create or replace function public.ingest_acquisition_lead(
  p_organization_id uuid,
  p_source_channel text,
  p_event_type text,
  p_external_lead_id text,
  p_external_campaign_id text,
  p_external_ad_id text,
  p_click_id text,
  p_campaign_id uuid,
  p_occurred_at timestamptz,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_latitude double precision,
  p_longitude double precision,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_phone_source text
)
returns table (
  lead_id uuid,
  lead_client_id uuid,
  acquisition_event_id uuid,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  property_id_value uuid;
  customer_id_value uuid;
  lead_id_value uuid;
  lead_client_id_value uuid;
  event_id_value uuid;
  existing_event record;
  normalized_key text;
  phone_digits_value text;
  email_lower_value text;
  dnc_lead_id uuid;
begin
  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if p_address_line1 is null or length(btrim(p_address_line1)) = 0 then
    raise exception 'property address is required' using errcode = '22023';
  end if;
  if p_source_channel not in (
    'door','referral','organic','google_ads','meta_ads','roofcare',
    'partner','manual','import','other'
  ) then
    raise exception 'unsupported acquisition source' using errcode = '22023';
  end if;
  if p_event_type not in (
    'lead_created','form_submitted','callback_requested','inspection_requested',
    'appointment_requested','referral_received','campaign_response','qualified',
    'disqualified','other'
  ) then
    raise exception 'unsupported acquisition event' using errcode = '22023';
  end if;
  if p_phone_source is not null and p_phone_source not in (
    'homeowner_at_door','homeowner_by_phone','homeowner_in_writing',
    'public_record','third_party_lookup','unknown'
  ) then
    raise exception 'unsupported phone source' using errcode = '22023';
  end if;

  if p_external_lead_id is not null and length(btrim(p_external_lead_id)) > 0 then
    select e.id, e.lead_id, l.client_id
      into existing_event
    from lead_acquisition_events e
    left join leads l on l.id = e.lead_id
    where e.organization_id = p_organization_id
      and e.source_channel = p_source_channel
      and e.external_lead_id = btrim(p_external_lead_id)
    limit 1;

    if found then
      return query
      select existing_event.lead_id, existing_event.client_id, existing_event.id, true;
      return;
    end if;
  end if;

  normalized_key := app.normalize_address(
    btrim(p_address_line1) || ' ' || coalesce(btrim(p_postal_code), '')
  );

  select p.id into property_id_value
  from properties p
  where p.organization_id = p_organization_id
    and p.deleted_at is null
    and p.normalized_address = normalized_key
  limit 1;

  if property_id_value is null then
    insert into properties (
      organization_id,
      address_line1,
      city,
      state,
      postal_code,
      location
    )
    values (
      p_organization_id,
      btrim(p_address_line1),
      nullif(btrim(coalesce(p_city, '')), ''),
      coalesce(nullif(btrim(coalesce(p_state, '')), ''), 'LA'),
      nullif(btrim(coalesce(p_postal_code, '')), ''),
      case
        when p_latitude between -90 and 90 and p_longitude between -180 and 180
          then st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)::geography
        else null
      end
    )
    returning id into property_id_value;
  elsif p_latitude between -90 and 90 and p_longitude between -180 and 180 then
    update properties
    set location = coalesce(
      location,
      st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)::geography
    )
    where id = property_id_value;
  end if;

  phone_digits_value := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  email_lower_value := nullif(lower(btrim(coalesce(p_email, ''))), '');

  if phone_digits_value is not null or email_lower_value is not null then
    select c.id into customer_id_value
    from customers c
    where c.organization_id = p_organization_id
      and c.deleted_at is null
      and (
        (phone_digits_value is not null and c.phone_digits = phone_digits_value)
        or (email_lower_value is not null and c.email_lower = email_lower_value)
      )
    order by
      case when phone_digits_value is not null and c.phone_digits = phone_digits_value then 0 else 1 end,
      c.updated_at desc
    limit 1;
  end if;

  if customer_id_value is null
     and (nullif(btrim(coalesce(p_first_name, '')), '') is not null
       or nullif(btrim(coalesce(p_last_name, '')), '') is not null) then
    insert into customers (
      organization_id,
      first_name,
      last_name,
      primary_phone,
      email,
      phone_source
    )
    values (
      p_organization_id,
      nullif(btrim(coalesce(p_first_name, '')), ''),
      nullif(btrim(coalesce(p_last_name, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      coalesce(p_phone_source, 'unknown')
    )
    returning id into customer_id_value;
  elsif customer_id_value is not null then
    update customers
    set
      first_name = coalesce(first_name, nullif(btrim(coalesce(p_first_name, '')), '')),
      last_name = coalesce(last_name, nullif(btrim(coalesce(p_last_name, '')), '')),
      primary_phone = coalesce(primary_phone, nullif(btrim(coalesce(p_phone, '')), '')),
      email = coalesce(email, nullif(btrim(coalesce(p_email, '')), '')),
      phone_source = case
        when primary_phone is null and nullif(btrim(coalesce(p_phone, '')), '') is not null
          then coalesce(p_phone_source, 'unknown')
        else phone_source
      end
    where id = customer_id_value;
  end if;

  -- A prior do-not-contact is the canonical lead. A new form/callback event is
  -- evidence to review, not permission to erase that suppression.
  select l.id into dnc_lead_id
  from leads l
  where l.organization_id = p_organization_id
    and l.property_id = property_id_value
    and l.deleted_at is null
    and l.status = 'do_not_contact'
  order by l.updated_at desc
  limit 1;

  if dnc_lead_id is not null then
    lead_id_value := dnc_lead_id;
  else
    select l.id into lead_id_value
    from leads l
    where l.organization_id = p_organization_id
      and l.property_id = property_id_value
      and l.deleted_at is null
      and l.status not in ('sold','lost','not_interested','do_not_contact')
    order by l.updated_at desc
    limit 1;
  end if;

  if lead_id_value is null then
    insert into leads (
      organization_id,
      property_id,
      customer_id,
      status,
      campaign_id
    )
    values (
      p_organization_id,
      property_id_value,
      customer_id_value,
      'target',
      p_campaign_id
    )
    returning id, client_id into lead_id_value, lead_client_id_value;
  else
    update leads
    set
      customer_id = coalesce(customer_id, customer_id_value),
      campaign_id = coalesce(campaign_id, p_campaign_id)
    where id = lead_id_value
    returning client_id into lead_client_id_value;
  end if;

  if customer_id_value is not null then
    insert into property_owners (property_id, customer_id, is_current)
    values (property_id_value, customer_id_value, true)
    on conflict (property_id, customer_id) do update
      set is_current = true;
  end if;

  insert into lead_acquisition_events (
    organization_id,
    lead_id,
    lead_client_id,
    campaign_id,
    source_channel,
    event_type,
    external_lead_id,
    external_campaign_id,
    external_ad_id,
    click_id,
    occurred_at,
    metadata
  )
  values (
    p_organization_id,
    lead_id_value,
    lead_client_id_value::text,
    p_campaign_id,
    p_source_channel,
    p_event_type,
    nullif(btrim(coalesce(p_external_lead_id, '')), ''),
    nullif(btrim(coalesce(p_external_campaign_id, '')), ''),
    nullif(btrim(coalesce(p_external_ad_id, '')), ''),
    nullif(btrim(coalesce(p_click_id, '')), ''),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('ingest', 'lead-acquisition-v1')
  )
  returning id into event_id_value;

  return query select lead_id_value, lead_client_id_value, event_id_value, false;
end;
$$;

revoke execute on function public.ingest_acquisition_lead(
  uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,text,text,
  double precision,double precision,text,text,text,text,text
) from public, anon, authenticated;

grant execute on function public.ingest_acquisition_lead(
  uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,text,text,
  double precision,double precision,text,text,text,text,text
) to service_role;

comment on function public.ingest_acquisition_lead(
  uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,text,text,
  double precision,double precision,text,text,text,text,text
) is
  'Server-only atomic acquisition ingest. Preserves DNC, contact provenance and external idempotency.';
