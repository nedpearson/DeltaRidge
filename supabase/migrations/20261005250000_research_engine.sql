-- 1. Source Registry
CREATE TABLE IF NOT EXISTS jurisdiction_data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL, -- ASSESSOR, PROPERTY, GIS, PERMIT, INSPECTION, STORM, CONTACT, OTHER
    official_url TEXT,
    api_url TEXT,
    access_method TEXT,
    rate_limit TEXT,
    terms_status TEXT,
    last_verified TIMESTAMPTZ,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Baton Rouge Sources
INSERT INTO jurisdiction_data_sources (jurisdiction, source_name, source_type, official_url, api_url, access_method, enabled) VALUES
('East Baton Rouge', 'Open Data BR - Permits', 'PERMIT', 'https://data.brla.gov/', 'https://data.brla.gov/resource/2k4w-p4ti.json', 'SOCRATA_SODA', true),
('East Baton Rouge', 'EBRGIS Assessor', 'ASSESSOR', 'https://ebrgis.maps.arcgis.com/', 'https://gis.brla.gov/arcgis/rest/services/EBRGIS/Parcels/MapServer/0', 'ESRI_REST', true),
('National', 'NOAA NCEI Storm Events', 'STORM', 'https://www.ncei.noaa.gov/', 'https://www.ncdc.noaa.gov/stormevents/csv', 'BULK_CSV', true),
('National', 'LexisNexis / Clearbit', 'CONTACT', NULL, NULL, 'LICENSED_API', false);

-- 2. Research Jobs System
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED, PROPERTY_LOOKUP, OWNER_LOOKUP, PERMIT_LOOKUP, STORM_LOOKUP, CONTACT_LOOKUP, RECONCILING, SUCCEEDED, PARTIAL, FAILED, RETRYING
    attempt INT DEFAULT 0,
    last_error TEXT,
    heartbeat TIMESTAMPTZ,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Extend properties with new fields if not exist
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS owner_type TEXT,
ADD COLUMN IF NOT EXISTS owner_mailing_address TEXT,
ADD COLUMN IF NOT EXISTS owner_source_record_id TEXT,
ADD COLUMN IF NOT EXISTS owner_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS owner_confidence TEXT,
ADD COLUMN IF NOT EXISTS roof_age_date DATE,
ADD COLUMN IF NOT EXISTS roof_age_basis TEXT,
ADD COLUMN IF NOT EXISTS roof_age_confidence TEXT,
ADD COLUMN IF NOT EXISTS geocode_source TEXT,
ADD COLUMN IF NOT EXISTS geocode_verified_at TIMESTAMPTZ;

-- 4. Extend customers with new fields if not exist
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS phone_confidence TEXT,
ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_confidence TEXT,
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- 5. Extend storm events with new fields if not exist
ALTER TABLE storm_events
ADD COLUMN IF NOT EXISTS event_id TEXT,
ADD COLUMN IF NOT EXISTS magnitude NUMERIC,
ADD COLUMN IF NOT EXISTS units TEXT,
ADD COLUMN IF NOT EXISTS county_parish TEXT;

ALTER TABLE property_storm_impacts
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS confidence TEXT;
