-- 0039 Document Center
-- Secure central table for all PDFs, photos, contracts, warranties, and reports.

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  property_id uuid references properties (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id),
  
  title text not null,
  category text not null, -- 'contract', 'proposal', 'estimate', 'eagleview', 'warranty', 'invoice', 'permit', 'other'
  file_url text not null, -- Storage URL or external bucket link
  file_type text not null, -- 'application/pdf', 'image/jpeg'
  file_size_bytes bigint,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on documents (organization_id, lead_id);
create index on documents (organization_id, property_id);
create index on documents (organization_id, customer_id);
create index on documents (organization_id, category);
create index on documents (created_at desc);

create trigger touch_documents before update on documents for each row execute function app.touch_updated_at();

alter table documents enable row level security;

create policy "Users can read org documents" on documents for select using (organization_id = app.current_organization());
create policy "Users can insert org documents" on documents for insert with check (organization_id = app.current_organization());
create policy "Users can update org documents" on documents for update using (organization_id = app.current_organization());
create policy "Users can delete org documents" on documents for delete using (organization_id = app.current_organization());
