-- 0037 Notification Center
-- Adds a generic notifications table for alerting users about actionable events.

create type notification_priority as enum ('low', 'medium', 'high', 'critical');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade, -- null = org-wide
  title text not null,
  body text not null,
  priority notification_priority not null default 'medium',
  link_url text, -- where clicking the notification goes
  reference_entity text, -- e.g. 'lead', 'property', 'inspection'
  reference_id uuid,
  read_at timestamptz,
  resolved_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on notifications (organization_id, user_id, read_at) where read_at is null;
create index on notifications (created_at desc);

create trigger touch_notifications before update on notifications for each row execute function app.touch_updated_at();

alter table notifications enable row level security;

create policy "Users can read their own or org-wide notifications"
  on notifications for select
  using (
    organization_id = app.current_organization()
    and (user_id is null or user_id = auth.uid())
  );

create policy "Users can update their own notifications (read/resolve)"
  on notifications for update
  using (
    organization_id = app.current_organization()
    and (user_id is null or user_id = auth.uid())
  );

-- Helper RPC to mark a notification read
create or replace function mark_notification_read(notification_id uuid)
returns void
language sql security invoker
as $$
  update notifications set read_at = now() where id = notification_id;
$$;
