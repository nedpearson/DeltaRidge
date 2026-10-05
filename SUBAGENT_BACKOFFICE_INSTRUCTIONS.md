# Delta Ridge Backoffice Reconstruction

You are executing Phase 6, 9, 25 of the Delta Ridge Reconstruction.

**Task 1: Settings Control Plane (Phase 6)**
Rewrite src/pages/SettingsPage.tsx to include the canonical list of settings sections requested:
MY ACCOUNT, ORGANIZATION, TEAM & ROLES, LEADS & SALES, STORMS, FIELD & GPS, AI & AUTOMATION, COMMUNICATIONS, INTEGRATIONS, NOTIFICATIONS, INSURANCE WORKFLOW, DATA & PRIVACY, SECURITY, SYSTEM HEALTH.
Use SegmentedTabs or a side-nav layout. Mock the individual panel contents if necessary, but the architecture must be complete.

**Task 2: Manager Dashboard & Storm OS (Phase 9 & 25)**
The current ManagerPage.tsx has StormCommandCenter. Ensure it is the canonical landing page for Managers (/manager or /storm-os if you prefer, but align with whatever Subagent A chooses for AppShell, which is likely /manager). 
Ensure the Manager Dashboard implements the Exception queues (Phase 13: Operate by Exception) and Actionable KPIs (Phase 25: ACTIVE STORMS, NEW LEADS, UNASSIGNED, ACTIVE REPS, ROUTES, APPOINTMENTS, FOLLOW-UPS, INSPECTIONS, ESTIMATES, WINS, PIPELINE, AI EXCEPTIONS, INTEGRATION ALERTS).

Ensure 
px tsc -b passes cleanly before finishing.
