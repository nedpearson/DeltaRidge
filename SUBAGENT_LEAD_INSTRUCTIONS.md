# Delta Ridge Lead Workspace Reconstruction

You are executing Phase 8 of the Delta Ridge Reconstruction.

**Task 1: Global Lead Workspace (LeadPage.tsx)**
The current LeadPage.tsx was partially modified, but we need ONE canonical Lead Workspace.
Rewrite src/pages/LeadPage.tsx to include tabs/sections:
- OVERVIEW
- PROPERTY & STORM
- COMMUNICATIONS (The Omnichannel Timeline)
- APPOINTMENTS & INSPECTIONS
- ESTIMATE & INSURANCE

Use progressive disclosure. Fetch all related data from Supabase.
Ensure you query the new omnichannel_timeline view for the communications tab.

**Task 2: Insurance Information Portal**
Ensure src/pages/HomeownerPortal.tsx securely collects carrier, policy_number, claim_number and saves it to insurance_profiles (which you must ensure exists in the schema or mock the UI connection for now).

Ensure 
px tsc -b passes.
