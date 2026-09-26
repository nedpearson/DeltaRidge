-- =============================================================================
-- RoofCare Post-Storm Automation
-- =============================================================================
-- When a severe storm event is recorded (hail >= 1.75 inches), this trigger 
-- automatically cross-references the storm's location with the properties of 
-- active RoofCare members. It generates a 'post_storm_priority' service ticket 
-- for the manager, fulfilling the core promise of the membership program.
-- =============================================================================

create or replace function process_roofcare_storm_alerts()
returns trigger
language plpgsql
security definer
as $func
declare
  member_record record;
  search_radius_meters float = 3218.69; -- 2 miles in meters
begin
  -- Only trigger for significant hail (>= 1.75 inches)
  if NEW.event_type = 'hail' and NEW.hail_size_inches >= 1.75 then
    
    -- Find active members whose property is affected
    for member_record in
      select 
        rm.id as membership_id, 
        rm.organization_id, 
        p.id as property_id
      from roofcare_memberships rm
      join properties p on rm.property_id = p.id
      where rm.status = 'active'
        and (
          -- If we have an affected area polygon, use precise intersection
          (NEW.affected_area is not null and st_intersects(p.location, NEW.affected_area))
          or
          -- Otherwise, fall back to a 2-mile radius from the report point
          (NEW.affected_area is null and st_dwithin(p.location, NEW.location, search_radius_meters))
        )
    loop
      
      -- Insert a priority service ticket for the member
      insert into roofcare_services (
        organization_id,
        membership_id,
        service_type,
        status,
        scheduled_for,
        notes
      ) values (
        member_record.organization_id,
        member_record.membership_id,
        'post_storm_priority',
        'scheduled',
        now(),
        'AUTOMATED DISPATCH: Property located within 2 miles of ' || NEW.hail_size_inches || ' inch hail report on ' || NEW.occurred_at::date || '.'
      );

      -- Optional: We could also trigger an entry in 
otification_center here for the manager
      
    end loop;
    
  end if;

  return NEW;
end;
$func;

drop trigger if exists roofcare_storm_alert_trigger on storm_events;
create trigger roofcare_storm_alert_trigger
  after insert on storm_events
  for each row
  execute function process_roofcare_storm_alerts();
