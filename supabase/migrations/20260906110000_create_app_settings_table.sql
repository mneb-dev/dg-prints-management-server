-- Singleton app-wide settings row: which payment methods and order channels are
-- currently offered, and the default shipping fee the order form prefills. The
-- `id = 'default'` check plus a fixed primary key keeps this to exactly one row.

create table if not exists app_settings (
  id text primary key default 'default' check (id = 'default'),
  payment_methods text[] not null default '{"GCash","Cash","Maya","Bank Transfer","Card"}',
  order_channels text[] not null default '{"Facebook","Walk-in","Shopee"}',
  shipping_fee numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

-- set_updated_at() already defined in 20260828193329_create_product_tables.sql.
drop trigger if exists app_settings_set_updated_at on app_settings;
create trigger app_settings_set_updated_at
  before update on app_settings
  for each row
  execute function set_updated_at();

insert into app_settings (id) values ('default') on conflict (id) do nothing;
