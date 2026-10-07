begin;
\set ON_ERROR_STOP on
select plan(7);
insert into organizations(id,name,slug) values ('aaaaaaaa-0808-0000-0000-000000000001','Private scope test','private-scope-test');
insert into auth.users(id,email) values
('bbbbbbbb-0808-0000-0000-000000000001','private-a@example.com'),
('bbbbbbbb-0808-0000-0000-000000000002','private-b@example.com'),
('bbbbbbbb-0808-0000-0000-000000000003','private-manager@example.com');
insert into organization_members(organization_id,user_id,role) values
('aaaaaaaa-0808-0000-0000-000000000001','bbbbbbbb-0808-0000-0000-000000000001','salesperson'),
('aaaaaaaa-0808-0000-0000-000000000001','bbbbbbbb-0808-0000-0000-000000000002','salesperson'),
('aaaaaaaa-0808-0000-0000-000000000001','bbbbbbbb-0808-0000-0000-000000000003','manager');
-- One open lead per property is a production invariant; use distinct homes.
insert into properties(id,organization_id,address_line1) values
('cccccccc-0808-0000-0000-000000000001','aaaaaaaa-0808-0000-0000-000000000001','101 Scope Test Street'),
('cccccccc-0808-0000-0000-000000000002','aaaaaaaa-0808-0000-0000-000000000001','102 Scope Test Street');
insert into leads(id,organization_id,property_id,assigned_to,created_by) values
('dddddddd-0808-0000-0000-000000000001','aaaaaaaa-0808-0000-0000-000000000001','cccccccc-0808-0000-0000-000000000001','bbbbbbbb-0808-0000-0000-000000000001','bbbbbbbb-0808-0000-0000-000000000003'),
('dddddddd-0808-0000-0000-000000000002','aaaaaaaa-0808-0000-0000-000000000001','cccccccc-0808-0000-0000-000000000002','bbbbbbbb-0808-0000-0000-000000000002','bbbbbbbb-0808-0000-0000-000000000003');
grant usage on schema public, app to authenticated;
grant all on all tables in schema public to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='bbbbbbbb-0808-0000-0000-000000000001';
select is((select count(*)::integer from leads where organization_id='aaaaaaaa-0808-0000-0000-000000000001'),1,'Rep A sees only assigned lead');
select is((with changed as (update leads set next_action_note='not allowed' where id='dddddddd-0808-0000-0000-000000000002' returning id) select count(*)::integer from changed),0,'Rep A cannot update rep B lead');
select is((select count(*)::integer from get_property_intelligence(null,null,50,'ALL',null) where lead_id='dddddddd-0808-0000-0000-000000000002'),0,'Map RPC hides peer lead');
select is((select count(*)::integer from get_property_intelligence(null,null,50,'ALL',null) where lead_id='dddddddd-0808-0000-0000-000000000001'),1,'Map RPC preserves own lead');
set local request.jwt.claim.sub='bbbbbbbb-0808-0000-0000-000000000002';
select is((select count(*)::integer from leads where organization_id='aaaaaaaa-0808-0000-0000-000000000001'),1,'Rep B sees only assigned lead');
set local request.jwt.claim.sub='bbbbbbbb-0808-0000-0000-000000000003';
select is((select count(*)::integer from leads where organization_id='aaaaaaaa-0808-0000-0000-000000000001'),2,'Manager sees both company leads');
select is((select count(*)::integer from get_property_intelligence(null,null,50,'ALL',null) where lead_id is not null),2,'Manager map RPC retains both leads');
reset role;
select * from finish();
rollback;
