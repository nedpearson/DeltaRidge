-- Add Subdivision / Neighborhood Clustering fields to properties

ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS subdivision_name text,
ADD COLUMN IF NOT EXISTS subdivision_source text,
ADD COLUMN IF NOT EXISTS subdivision_verified_at timestamptz,
ADD COLUMN IF NOT EXISTS subdivision_confidence text;
