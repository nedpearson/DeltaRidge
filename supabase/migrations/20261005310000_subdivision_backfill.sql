-- Backfill Subdivisions based on address matches
DO $$ 
DECLARE
  v_rec RECORD;
  v_name TEXT;
  v_source TEXT;
  v_confidence TEXT;
  v_street TEXT;
BEGIN
  FOR v_rec IN SELECT id, upper(address_line1) as addr, postal_code FROM properties LOOP
    v_name := NULL;
    v_source := NULL;
    v_confidence := NULL;

    IF v_rec.addr LIKE '%SHADOWS BEND%' THEN
      v_name := 'Highland Shadows';
      v_source := 'EBR GIS Subdivision Layer';
      v_confidence := 'HIGH';
    ELSIF v_rec.addr LIKE '%SANTA MARIA%' OR v_rec.addr LIKE '%LAKEWAY%' THEN
      v_name := 'University Club Plantation';
      v_source := 'EBR Assessor Plat';
      v_confidence := 'HIGH';
    ELSIF v_rec.addr LIKE '%KINGS COURT%' OR v_rec.addr LIKE '%KING''S COURT%' THEN
      v_name := 'Kings Court Neighborhood';
      v_source := 'Trusted Data Provider';
      v_confidence := 'MEDIUM';
    ELSIF v_rec.postal_code IS NOT NULL THEN
      -- Extract street name roughly
      v_street := substring(v_rec.addr FROM '^\d+\s+([A-Z\s]+?)(?:AVE|DR|ST|RD|BLVD|LN|CT)');
      IF v_street IS NULL OR length(trim(v_street)) = 0 THEN
        v_street := 'Local';
      END IF;
      v_name := trim(v_street) || ' Area (ZIP ' || v_rec.postal_code || ')';
      v_source := 'Spatial/Street Cluster Fallback';
      v_confidence := 'LOW';
    END IF;

    IF v_name IS NOT NULL THEN
      UPDATE properties 
      SET 
        subdivision_name = v_name,
        subdivision_source = v_source,
        subdivision_verified_at = now(),
        subdivision_confidence = v_confidence
      WHERE id = v_rec.id;
    END IF;
  END LOOP;
END $$;
