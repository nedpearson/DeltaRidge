# Delta Ridge Comprehensive Audit & Execution Plan

Based on the directive to conduct a "complete deep audit," ensure "everything is built out end to end," provide "drilldowns throughout to the source of truth," and "make sure every lead is a real lead," I have surveyed the architecture.

## Findings: Where the "Source of Truth" is Missing in the UI

The database currently tracks deep provenance across multiple tables (where a phone number came from, the exact timestamp NOAA verified a storm, where the roof age estimate was acquired, etc.). However, the front-end components (specifically the `IntegrityPanel` and Lead drilldowns) are using placeholder defaults (`stormSource: null`, `imageryCapturedAt: null`) instead of pulling the real intelligence from the backend. 

## Action Plan (Executing Now)

### Phase 1: Property Intelligence Deep Drilldowns (In Progress)
- **Roof Age & Permits:** Wire the `roof_age_source` and `last_roof_permit_source` from the `properties` table directly into the UI. If a roof age is derived from a 2008 building permit, the app must explicitly state "18 Years (Sourced from 2008 Re-roof Permit)".
- **Owner Verification:** Drilldown to display `owner_source` (e.g., Parish Tax Assessor vs Third-Party skip trace) to guarantee it's a real lead.
- **Subdivision Confidence:** Wire `subdivision_source` to show whether a property's inclusion in a targeted neighborhood was determined by strict GIS boundaries or inferred.

### Phase 2: Storm & Aerial Evidence Wiring
- **NOAA Drilldowns:** Link the Lead's `stormSource` and `stormEventAt` to the `property_storm_evidence` timeline so reps can see *exactly* when the 60+ MPH wind or 1.5" hail was recorded.
- **EagleView / Imagery Capture:** Link `imagery_captured_at` from the backend to guarantee the aerial photo used to score the lead was actually taken *after* the storm event.

### Phase 3: Lead Qualification Guarantee
- Enforce strict visibility on `phone_verification_status` and `email_verification_status` to visually distinguish a guaranteed contact from a raw data-broker lookup.

I am executing Phase 1 and 2 directly on the codebase now to ensure every piece of evidence backing a Lead is transparent, verified, and surfaced to the rep.
