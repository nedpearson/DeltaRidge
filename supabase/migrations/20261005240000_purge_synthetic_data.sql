-- Cleanup synthetic identity and intelligence data

-- 1. Purge synthetic properties
UPDATE properties 
SET owner_name = NULL, 
    owner_source = NULL, 
    roof_age_years = NULL, 
    roof_age_source = NULL,
    last_roof_permit_date = NULL, 
    last_roof_permit_desc = NULL, 
    last_roof_permit_source = NULL,
    opportunity_summary = NULL
WHERE owner_name IN ('Jane Smith', 'John Doe') 
   OR owner_source IN ('Assessor DB', 'East Baton Rouge Assessor')
   OR opportunity_summary = 'Backfilled intelligence report.';

-- 2. Purge synthetic contacts
UPDATE customers
SET primary_phone = NULL, 
    phone_source = NULL, 
    phone_verification_status = 'NOT_FOUND',
    email = NULL, 
    email_source = NULL, 
    email_verification_status = 'NOT_FOUND'
WHERE email LIKE '%@example.com' 
   OR primary_phone LIKE '(225) 555-%' 
   OR phone_source = 'third_party_lookup'
   OR email_source = 'LexisNexis'
   OR first_name IN ('Jane', 'John') AND last_name IN ('Smith', 'Doe');

-- 3. Purge synthetic storm events and impacts created by the backfill scripts
DELETE FROM property_storm_impacts
WHERE storm_event_id IN (
    SELECT id FROM storm_events WHERE provider = 'NWS' AND occurred_at > '2026-10-04'
);

DELETE FROM storm_events 
WHERE provider = 'NWS' AND occurred_at > '2026-10-04';
