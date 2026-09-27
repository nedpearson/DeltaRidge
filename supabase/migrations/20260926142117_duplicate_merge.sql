create or replace function merge_leads(target_lead_id uuid, duplicate_lead_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Transfer activities (which includes notes)
  update activities
  set lead_id = target_lead_id
  where lead_id = duplicate_lead_id;

  -- Transfer inspections (office_handoffs are linked via inspection_id, so they move along)
  update inspections
  set lead_id = target_lead_id
  where lead_id = duplicate_lead_id;

  -- Soft delete the duplicate lead
  update leads
  set deleted_at = now()
  where id = duplicate_lead_id;
end;
$$;
