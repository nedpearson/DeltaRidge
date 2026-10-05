# Delta Ridge UX Reconstruction

You are executing Phase 4 & 5 of the Delta Ridge Reconstruction.

**Task 1: Rewrite AppShell.tsx**
Remove the old monolithic tabs (/leads, etc).
Adopt a role-specific navigation approach based on the BrickYard pattern:
- Managers see: /, /storm-os, /team, /settings
- Reps see: /, /map, /inspections
Modify AppShell.tsx to read the session's role (using pp.has_org_role or the membership object returned by auth context) and display the correct tabs.

**Task 2: Rewrite HomePage.tsx (Start Here Orchestration)**
Remove the stale "GOOD MORNING", "Nearby Opportunities", etc.
Create two distinct dashboards in HomePage.tsx:
1. ManagerDashboard (if role is admin/manager):
   - Shows "Active Storms"
   - "Unassigned Priority Leads"
   - "Active Reps"
   - "Blockers / Exceptions"
2. RepDashboard (if role is rep):
   - Shows "Next Appointment"
   - "Active Route" or "Start Route"
   - "Open Inspections"

You don't need to implement every backend API yet; create the UI components fetching from the new schemas (property_opportunity_scores, storm_events, inspections) using @supabase/supabase-js. Ensure it is visually polished, 0 dead ends.

**Task 3: Universal Search**
Ensure UniversalSearch points to the canonical workspaces (e.g. /lead/:id, /property/:id).

Do not leave any "TODOs" that break the build. Ensure 
px tsc -b passes.
