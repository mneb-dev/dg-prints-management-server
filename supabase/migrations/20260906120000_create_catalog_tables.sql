-- Payment methods and order channels become real, manageable rows (name, enabled,
-- sort_order) instead of a fixed catalog toggled on/off from app_settings — supports
-- full CRUD plus manual reordering. Seed each from the current app_settings arrays
-- (preserving order), then drop those now-redundant columns.

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

insert into payment_methods (name, sort_order)
select value, ordinality - 1
from app_settings, unnest(payment_methods) with ordinality as t(value, ordinality)
where id = 'default';

insert into order_channels (name, sort_order)
select value, ordinality - 1
from app_settings, unnest(order_channels) with ordinality as t(value, ordinality)
where id = 'default';

alter table app_settings drop column payment_methods;
alter table app_settings drop column order_channels;
