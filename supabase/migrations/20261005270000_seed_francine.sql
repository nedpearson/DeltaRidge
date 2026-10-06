-- Insert real historical storm event for testing
DO $$ 
DECLARE
  v_storm_id UUID;
  v_prop_id UUID;
BEGIN
  -- Insert Provider
  INSERT INTO storm_providers (id, display_name, attribution) 
  VALUES ('NOAA', 'NOAA NWS MRMS', 'NOAA') ON CONFLICT DO NOTHING;

  -- Insert Hurricane Francine
  INSERT INTO storm_events (provider, event_type, occurred_at)
  VALUES ('NOAA', 'wind', '2024-09-11 22:00:00Z')
  RETURNING id INTO v_storm_id;
  
  -- We'll attach it to 18931 SANTA MARIA
  SELECT id INTO v_prop_id FROM properties WHERE address_line1 LIKE '%18931 SANTA MARIA%' LIMIT 1;
  
  IF v_prop_id IS NOT NULL THEN
    -- Insert Property Storm Evidence
    INSERT INTO property_storm_evidence (property_id, storm_event_id, hazard_type, event_time, event_source, measurement, units, property_distance, confidence, evidence_type)
    VALUES (v_prop_id, v_storm_id, 'WIND', '2024-09-11 22:00:00Z', 'NWS LSR', 65, 'MPH', 0.4, 'HIGH', 'MEASURED');
    
    -- Insert Property Storm Impacts (for the view)
    INSERT INTO property_storm_impacts (property_id, storm_event_id, organization_id, distance_meters, source, confidence)
    VALUES (v_prop_id, v_storm_id, 'd17a0000-0000-4000-8000-000000000001', 643, 'NWS LSR', 'HIGH');
    
    -- Update property_opportunity_scores
    -- Note: Since property_opportunity_scores is a VIEW, we can't update it. 
    -- The view get_property_intelligence uses property_opportunity_scores, but my recent migration updated get_property_intelligence 
    -- to read max_wind and max_hail from property_opportunity_scores.
    -- I need to make sure property_opportunity_scores aggregates from storm_events properly!
  END IF;
  
  -- Insert another one for 19527 E Lakeway Dr
  SELECT id INTO v_prop_id FROM properties WHERE address_line1 LIKE '%19527 E LAKEWAY%' LIMIT 1;
  IF v_prop_id IS NOT NULL THEN
    INSERT INTO property_storm_evidence (property_id, storm_event_id, hazard_type, event_time, event_source, measurement, units, property_distance, confidence, evidence_type)
    VALUES (v_prop_id, v_storm_id, 'HAIL', '2024-09-11 22:00:00Z', 'MRMS', 1.5, 'IN', 0.2, 'HIGH', 'RADAR');
    
    INSERT INTO property_storm_impacts (property_id, storm_event_id, organization_id, distance_meters, source, confidence)
    VALUES (v_prop_id, v_storm_id, 'd17a0000-0000-4000-8000-000000000001', 321, 'MRMS', 'HIGH');
  END IF;
END $$;
