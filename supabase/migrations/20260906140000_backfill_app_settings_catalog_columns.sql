-- Repairs environments where app_settings predates 20260906110000_create_app_settings_table.sql
-- (created earlier, by hand, with only id/shipping_fee/created_at/updated_at). There,
-- 20260906110000's "create table if not exists" silently no-op'd and never added the
-- payment_methods/order_channels columns, which broke 20260906120000_create_catalog_tables.sql
-- (it assumes those columns exist to seed payment_methods/order_channels from).
--
-- Re-creates payment_methods/order_channels (no-op if 20260906120000 already made them), then only
-- backfills app_settings' columns and reseeds if both tables are still empty -- i.e. only where
-- 20260906120000 never actually completed. This makes the whole file a true no-op anywhere that
-- migration already succeeded (dev, and any fresh install that ran 20260906120000 normally).

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_methods_name_key on payment_methods (lower(name));
alter table payment_methods enable row level security;
drop trigger if exists payment_methods_set_updated_at on payment_methods;
create trigger payment_methods_set_updated_at
  before update on payment_methods
  for each row
  execute function set_updated_at();

create table if not exists order_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists order_channels_name_key on order_channels (lower(name));
alter table order_channels enable row level security;
drop trigger if exists order_channels_set_updated_at on order_channels;
create trigger order_channels_set_updated_at
  before update on order_channels
  for each row
  execute function set_updated_at();

do $$
begin
  if not exists (select 1 from payment_methods) and not exists (select 1 from order_channels) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'payment_methods'
    ) then
      alter table app_settings
        add column payment_methods text[] not null default '{"GCash","Cash","Maya","Bank Transfer","Card"}';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'order_channels'
    ) then
      alter table app_settings
        add column order_channels text[] not null default '{"Facebook","Walk-in","Shopee"}';
    end if;

    insert into payment_methods (name, sort_order)
    select value, ordinality - 1
    from app_settings, unnest(payment_methods) with ordinality as t(value, ordinality)
    where id = 'default';

    insert into order_channels (name, sort_order)
    select value, ordinality - 1
    from app_settings, unnest(order_channels) with ordinality as t(value, ordinality)
    where id = 'default';

    alter table app_settings drop column if exists payment_methods;
    alter table app_settings drop column if exists order_channels;
  end if;
end $$;
