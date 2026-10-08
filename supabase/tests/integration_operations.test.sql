begin;
select plan(7);
insert into auth.users(id,email) values
 ('77777777-7777-4777-8777-777777777771','integration-one@example.test'),
 ('77777777-7777-4777-8777-777777777772','integration-two@example.test');
insert into organizations(id,name,slug) values
 ('77777777-7777-4777-8777-777777777781','Integration One','integration-one'),
 ('77777777-7777-4777-8777-777777777782','Integration Two','integration-two');
insert into organization_members(organization_id,user_id,role) values
 ('77777777-7777-4777-8777-777777777781','77777777-7777-4777-8777-777777777771','salesperson'),
 ('77777777-7777-4777-8777-777777777782','77777777-7777-4777-8777-777777777772','salesperson');
insert into integration_runs(organization_id,integration,status,detail) values
 ('77777777-7777-4777-8777-777777777781','contacts','success','Own result'),
 ('77777777-7777-4777-8777-777777777782','contacts','success','Other company result');
insert into push_subscriptions(organization_id,user_id,endpoint,p256dh,auth_key) values
 ('77777777-7777-4777-8777-777777777781','77777777-7777-4777-8777-777777777771','https://fcm.googleapis.com/test-one','test-key','test-auth'),
 ('77777777-7777-4777-8777-777777777782','77777777-7777-4777-8777-777777777772','https://fcm.googleapis.com/test-two','test-key','test-auth');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777771","role":"authenticated"}',true);
select is((select count(*)::int from integration_runs),1,'Integration traffic is limited to the caller company');
select is((select count(*)::int from push_subscriptions),1,'Device keys are limited to their owner');
select is((select count(*)::int from push_subscriptions where user_id='77777777-7777-4777-8777-777777777772'),0,'Another company device is not visible');
select throws_ok($$insert into integration_runs(organization_id,integration,status) values('77777777-7777-4777-8777-777777777781','push','success')$$,'42501',null,'Devices cannot forge successful delivery receipts');
select throws_ok($$insert into push_subscriptions(organization_id,user_id,endpoint,p256dh,auth_key) values('77777777-7777-4777-8777-777777777782','77777777-7777-4777-8777-777777777772','https://fcm.googleapis.com/forged','test','test')$$,'42501',null,'Devices cannot register under another user');
reset role;
insert into properties(id,organization_id,address_line1,city,postal_code) values
 ('77777777-7777-4777-8777-777777777791','77777777-7777-4777-8777-777777777781','Integration test property','Baton Rouge','70801');
insert into leads(id,organization_id,property_id,assigned_to,status) values
 ('77777777-7777-4777-8777-777777777799','77777777-7777-4777-8777-777777777781','77777777-7777-4777-8777-777777777791','77777777-7777-4777-8777-777777777771','target');
select is((select count(*)::int from notifications where reference_id='77777777-7777-4777-8777-777777777799'),1,'A lead assignment creates one notification');
update leads set status='interested' where id='77777777-7777-4777-8777-777777777799';
select is((select count(*)::int from notifications where reference_id='77777777-7777-4777-8777-777777777799'),1,'Unrelated lead edits do not duplicate the assignment alert');
select * from finish();
rollback;
