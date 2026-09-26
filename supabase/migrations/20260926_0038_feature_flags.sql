-- 0038 Feature Flags

create table feature_flags (
  id text primary key, -- e.g., 'new_lead_scoring', 'eagleview_beta'
  description text,
  enabled_for_all boolean not null default false,
  enabled_for_roles text[] not null default '{}', -- e.g., ['admin', 'manager']
  enabled_for_users uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger touch_feature_flags before update on feature_flags for each row execute function app.touch_updated_at();

alter table feature_flags enable row level security;

-- Everyone can read feature flags so the client app knows what features are enabled
create policy "Anyone can view feature flags" on feature_flags for select using (true);
