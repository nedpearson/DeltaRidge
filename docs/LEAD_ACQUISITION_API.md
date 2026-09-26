# Delta Ridge Lead Acquisition API

Delta Ridge exposes one signed server-to-server endpoint for inbound lead sources:

`POST /functions/v1/lead-acquisition`

This is the canonical ingestion seam for Google lead forms, Meta lead forms,
Zapier, approved partners, website forms, referral systems and future adapters.

The endpoint does **not** grant consent, send a message, or place a call. It
creates/links the CRM record, stores source attribution and creates a human
qualification/appointment task when the event indicates intent.

## Authentication

Each Delta Ridge organization owns a random 256-bit acquisition token.

Send it in:

`x-delta-ridge-token: <secret>`

Only the SHA-256 hash is stored. The plain token is shown once when generated.

The request body must include the organization's UUID. The token is verified
against that organization before the service-role ingest RPC is called.

## Idempotency

For an external source, always send a stable `external_lead_id`.

Delta Ridge deduplicates on:

`organization_id + source_channel + external_lead_id`

Retrying the same provider delivery therefore returns the existing lead/event
instead of creating another customer or property.

## Canonical request

```json
{
  "organization_id": "00000000-0000-0000-0000-000000000000",
  "source_channel": "google_ads",
  "event_type": "appointment_requested",
  "external_lead_id": "provider-stable-id",
  "external_campaign_id": "campaign-id",
  "external_ad_id": "ad-id",
  "click_id": "gclid-or-provider-click-id",
  "campaign_id": null,
  "occurred_at": "2026-09-26T03:15:00Z",
  "property": {
    "address_line1": "123 Main St",
    "city": "Baton Rouge",
    "state": "LA",
    "postal_code": "70810",
    "latitude": 30.0000,
    "longitude": -91.0000
  },
  "contact": {
    "first_name": "Jane",
    "last_name": "Smith",
    "phone": "2255550100",
    "email": "jane@example.com",
    "phone_source": "homeowner_in_writing"
  }
}
```

## Source channels

Accepted `source_channel` values:

- `door`
- `referral`
- `organic`
- `google_ads`
- `meta_ads`
- `roofcare`
- `partner`
- `manual`
- `import`
- `other`

Do not map a source to `google_ads` or `meta_ads` merely because Zapier was
used as transport. Source means where the homeowner opportunity originated;
Zapier is transport.

## Event types

Accepted `event_type` values:

- `lead_created`
- `form_submitted`
- `callback_requested`
- `inspection_requested`
- `appointment_requested`
- `referral_received`
- `campaign_response`
- `qualified`
- `disqualified`
- `other`

High-intent events create a human action task. They do not automatically contact
the homeowner.

## Contact provenance

Accepted `phone_source` values:

- `homeowner_at_door`
- `homeowner_by_phone`
- `homeowner_in_writing`
- `public_record`
- `third_party_lookup`
- `unknown`

A provider or enrichment phone should normally be
`third_party_lookup`, **not** `homeowner_in_writing`.

A Google/Meta lead form phone may be `homeowner_in_writing` only when the form
submission itself actually contains that homeowner-entered phone number and the
company's compliance review supports that provenance. The source field still
does not by itself establish all permission required for every communication
channel.

## DNC / opt-out behavior

A new inbound event never silently removes an existing Delta Ridge
`do_not_contact` state.

If the property already has a DNC lead:

1. the event is attached to that canonical lead;
2. the generated setter task is blocked;
3. a person reviews the new homeowner request and the applicable consent before
   changing suppression.

This avoids both failure modes: ignoring a genuine new homeowner request and
silently reviving an old suppressed contact.

## Provider mappings

### Google Ads lead forms

Where available from the current Google Ads lead-form submission record:

- provider submission id → `external_lead_id`
- campaign id → `external_campaign_id`
- ad/ad-group identifier when available → `external_ad_id`
- GCLID → `click_id`
- submitted timestamp → `occurred_at`
- address/contact form fields → canonical property/contact fields
- source → `google_ads`

Do not manufacture an address when a Google form did not collect one. The
Delta Ridge endpoint requires a property address because the product is
property-centric; route incomplete submissions through an upstream qualification
step until the property is known.

### Meta lead forms

Map the provider's stable lead id to `external_lead_id`, campaign/ad ids to
their corresponding fields, and homeowner-entered property/contact fields to
the canonical request. Use `source_channel=meta_ads`.

A direct Meta Graph adapter should not be represented as connected until its
current official API version, permissions and business access have been
verified in the deployed account. Zapier or another approved transport can post
the same canonical payload without changing Delta Ridge's internal model.

### Website / organic

- source → `organic`
- stable form submission id → `external_lead_id`
- request type → appropriate event type
- homeowner-entered property/contact fields → canonical fields

### Referral

- source → `referral`
- referral system id → `external_lead_id`
- event → `referral_received`

## Response

Successful responses return:

```json
{
  "success": true,
  "lead_client_id": "stable-client-uuid",
  "acquisition_event_id": "event-uuid",
  "duplicate": false
}
```

Use `lead_client_id` for Delta Ridge deep links and cross-device Lead 360.

## Production verification

Before calling a source connected:

1. create/rotate the organization acquisition token;
2. POST a synthetic provider payload;
3. verify the response returns a stable lead client id;
4. resend the same external id and verify `duplicate=true`;
5. open the Setter tab and verify exactly one human task;
6. open Lead 360 from a second device;
7. verify source attribution;
8. verify DNC remains blocked when tested against a suppressed lead;
9. verify no outbound call/text/email happened automatically;
10. verify Integration Health records the inbound timestamp.
