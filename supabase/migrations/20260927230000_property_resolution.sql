-- Add geolocation and provenance metadata to properties
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS geocoder text,
ADD COLUMN IF NOT EXISTS geocode_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS confidence text,
ADD COLUMN IF NOT EXISTS normalization_version text,
ADD COLUMN IF NOT EXISTS provenance text,
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric;

-- Also add a resolution RPC that normalizes and finds a property
CREATE OR REPLACE FUNCTION public.resolve_property_from_address(org_id uuid, address_query text)
RETURNS TABLE (
    id uuid,
    normalized_address text,
    location geography
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.normalized_address, p.location
    FROM properties p
    WHERE p.organization_id = org_id
      AND p.normalized_address = app.normalize_address(address_query)
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_property_from_address(uuid, text) TO authenticated, service_role;
