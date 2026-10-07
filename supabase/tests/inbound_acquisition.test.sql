begin;
\set ON_ERROR_STOP on
insert into organizations(id,name,slug) values('dddddddd-0707-0000-0000-000000000001','Acquisition tests','acquisition-tests');
insert into auth.users(id,email) values('eeeeeeee-0707-0000-0000-000000000001','acquisition-manager@example.com'),('eeeeeeee-0707-0000-0000-000000000002','acquisition-rep@example.com');
insert into organization_members(organization_id,user_id,role) values
 ('dddddddd-0707-0000-0000-000000000001','eeeeeeee-0707-0000-0000-000000000001','manager'),
 ('dddddddd-0707-0000-0000-000000000001','eeeeeeee-0707-0000-0000-000000000002','salesperson');
do $$
declare p jsonb; r uuid; again uuid; a uuid; second_appt uuid; n integer; ok boolean;
begin
 p:=jsonb_build_object('requestKey','ffffffff-0707-0000-0000-000000000001','name','Test Homeowner','address','123 Example Street, Baton Rouge LA 70809','email','test@example.com','contactConsent',true,'contactDisclosure','Test inspection contact authorization','preferredDay','','notes','Test only','attribution',jsonb_build_object('utm_source','google','ref','partner-1'));
 r:=submit_inspection_request('dddddddd-0707-0000-0000-000000000001',p);
 again:=submit_inspection_request('dddddddd-0707-0000-0000-000000000001',p);
 if r<>again then raise exception 'Retry produced duplicate request'; end if;
 if (select count(*) from inspection_requests where organization_id='dddddddd-0707-0000-0000-000000000001')<>1 then raise exception 'Duplicate request'; end if;
 if (select count(*) from leads where organization_id='dddddddd-0707-0000-0000-000000000001')<>1 then raise exception 'Duplicate lead'; end if;
 if (select count(*) from appointments where organization_id='dddddddd-0707-0000-0000-000000000001')<>0 then raise exception 'Submission booked without confirmation'; end if;
 begin
   perform confirm_inspection_request(r,now()+interval '1 day','eeeeeeee-0707-0000-0000-000000000002');
   raise exception 'Unauthorized booking succeeded';
 exception when raise_exception then
   if SQLERRM='Unauthorized booking succeeded' then raise; end if;
 end;
 a:=confirm_inspection_request(r,now()+interval '1 day','eeeeeeee-0707-0000-0000-000000000001');
 second_appt:=confirm_inspection_request(r,now()+interval '2 days','eeeeeeee-0707-0000-0000-000000000001');
 if a<>second_appt then raise exception 'Retry produced duplicate appointment'; end if;
 if (select status from inspection_requests where id=r)<>'confirmed' then raise exception 'Confirmation not persisted'; end if;
 if has_function_privilege('anon','public.submit_inspection_request(uuid,jsonb)','EXECUTE') then raise exception 'Anonymous direct write RPC exposed'; end if;
 if has_function_privilege('authenticated','public.confirm_inspection_request(uuid,timestamptz,uuid)','EXECUTE') then raise exception 'Actor spoofing RPC exposed'; end if;
 for n in 1..20 loop ok:=consume_acquisition_limit('acquisition-test-bucket');if not ok then raise exception 'Rate limit rejected early';end if;end loop;
 if consume_acquisition_limit('acquisition-test-bucket') then raise exception 'Rate limit failed';end if;
end $$;
select plan(1);
select pass('Acquisition retry, booking authorization, persistence and rate-limit assertions');
select * from finish();
rollback;
