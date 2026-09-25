create table campaigns (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,
    is_active boolean not null default true,
    area geography(Geometry, 4326) not null
);

alter table campaigns enable row level security;

create policy "Managers can read campaigns"
    on campaigns for select
    to authenticated
    using (true);

create policy "Managers can insert campaigns"
    on campaigns for insert
    to authenticated
    with check (true);

create policy "Managers can update campaigns"
    on campaigns for update
    to authenticated
    using (true);