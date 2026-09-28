CREATE OR REPLACE FUNCTION public.check_storm_exposure_for_address(org_id uuid, search_address text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_property_id uuid;
  v_location geography;
  v_storm record;
BEGIN
  -- 1. Resolve property
  SELECT id, location INTO v_property_id, v_location
  FROM properties
  WHERE organization_id = org_id
    AND normalized_address = app.normalize_address(search_address)
  LIMIT 1;

  IF v_property_id IS NULL THEN
    -- Insert a minimal record (since it's an inquiry)
    -- In a real scenario, we'd fire an edge function to geocode it asynchronously,
    -- but for immediate response, if we don't have coordinates, we must return "Unable to determine"
    INSERT INTO properties (organization_id, address_line1, normalized_address, provenance)
    VALUES (org_id, search_address, app.normalize_address(search_address), 'free_roof_check')
    RETURNING id INTO v_property_id;
  END IF;

  IF v_location IS NULL THEN
    RETURN jsonb_build_object('status', 'unable_to_determine', 'reason', 'Property coordinates not yet available for spatial lookup.');
  END IF;

  -- 2. Spatial lookup
  SELECT id, event_type, occurred_at INTO v_storm
  FROM storm_events
  WHERE ST_Intersects(affected_area, v_location)
    AND occurred_at > (now() - interval '2 years')
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_storm.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'exposed', 'event_type', v_storm.event_type, 'occurred_at', v_storm.occurred_at);
  ELSE
    RETURN jsonb_build_object('status', 'clear', 'message', 'No severe recent storm activity was recorded for this specific location.');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_storm_exposure_for_address(uuid, text) TO anon, authenticated, service_role;
