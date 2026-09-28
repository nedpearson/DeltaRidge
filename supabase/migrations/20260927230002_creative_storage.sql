insert into storage.buckets (id, name, public) 
values ('creative-assets', 'creative-assets', true)
on conflict (id) do nothing;

create policy "Org members can upload creative assets" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'creative-assets'
  and (storage.foldername(name))[1] in (
    select organization_id::text
    from public.organization_members
    where user_id = auth.uid()
  )
);

create policy "Org members can view creative assets" on storage.objects
for select to authenticated
using (
  bucket_id = 'creative-assets'
  and (storage.foldername(name))[1] in (
    select organization_id::text
    from public.organization_members
    where user_id = auth.uid()
  )
);
