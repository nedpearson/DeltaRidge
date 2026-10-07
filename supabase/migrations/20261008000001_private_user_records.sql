-- Restrictive policies compose with existing organization policies (AND).
-- They cannot accidentally widen access through an older permissive policy.
begin;
create policy leads_private_user_scope on public.leads as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or assigned_to = auth.uid() or created_by = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or (assigned_to = auth.uid() or (created_by = auth.uid() and assigned_to is null)));
create policy appointments_private_user_scope on public.appointments as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or assigned_to = auth.uid() or created_by = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or (assigned_to = auth.uid() or (created_by = auth.uid() and assigned_to is null)));
create policy activities_private_user_scope on public.activities as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or user_id = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or user_id = auth.uid());
create policy inspections_private_user_scope on public.inspections as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or inspector_id = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or inspector_id = auth.uid());
create policy photos_private_user_scope on public.photos as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or captured_by = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or captured_by = auth.uid());
create policy voice_notes_private_user_scope on public.voice_notes as restrictive for all to authenticated
using (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or recorded_by = auth.uid())
with check (app.has_org_role(organization_id, array['admin','manager','office']::app_role[]) or recorded_by = auth.uid());
do $$ declare t text; begin
foreach t in array array['inspection_observations','inspection_checklist_items'] loop
execute format('create policy %1$s_private_user_scope on public.%1$I as restrictive for all to authenticated using (exists (select 1 from public.inspections i where i.id = inspection_id and i.organization_id = %1$I.organization_id)) with check (exists (select 1 from public.inspections i where i.id = inspection_id and i.organization_id = %1$I.organization_id))',t);
end loop; end $$;
create policy photo_ai_analysis_private_user_scope on public.photo_ai_analysis as restrictive for all to authenticated
using (exists (select 1 from public.photos p where p.id = photo_id and p.organization_id = photo_ai_analysis.organization_id))
with check (exists (select 1 from public.photos p where p.id = photo_id and p.organization_id = photo_ai_analysis.organization_id));
commit;
