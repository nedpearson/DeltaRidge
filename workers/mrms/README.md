# Delta Ridge MRMS worker

Downloads NOAA/NSSL MRMS `MESH_Max_30min` GRIB2, converts the GRIB base unit
(mm) to inches, keeps only thresholded cells inside the configured operating
bbox, and writes them to Supabase.

Official source:
- https://mrms.ncep.noaa.gov/2D/MESH_Max_30min/
- latest file: `MRMS_MESH_Max_30min.latest.grib2.gz`

This data is **radar-estimated hail**, not proof that hail reached a roof.

## Required variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MRMS_BBOX` as `west,south,east,north`

Example service-area bbox:

`-91.5,30.1,-90.5,30.9`

Do not hard-code this in product code. Configure the deployment for the actual
operating territory.

## Optional variables

- `MRMS_PRODUCT_URL` defaults to NOAA MESH Max 30-minute latest
- `MRMS_STORE_MIN_INCHES` defaults to `0.50`
- `MRMS_BATCH_SIZE` defaults to `750`

Run this as a Railway cron every five minutes. Database idempotency prevents a
repeated NOAA file from creating duplicate cells.

The worker intentionally does not backfill 24 months. The public live directory
does not establish a 24-month archive. Historical lead ranking continues to use
the existing NOAA NCEI SWDI path; MRMS adds higher-resolution current/future
radar evidence from the point production ingestion begins.
