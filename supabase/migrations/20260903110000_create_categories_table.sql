-- Product categories: a simple name+active entity. Icon/color and the
-- per-category order-status flow remain hardcoded lookups in the frontend
-- (see CATEGORY_STATUS_FLOWS in order-status.ts) with a fallback for any
-- category not present in those maps — this table intentionally carries no
-- icon/color/status-flow columns.

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists categories_name_key on categories (lower(name));

alter table categories enable row level security;
-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

-- set_updated_at() already defined in 20260828193329_create_product_tables.sql.
drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
  before update on categories
  for each row
  execute function set_updated_at();

-- Seed the categories already in use by existing products/calculator/pricing
-- logic so the picker isn't empty on first deploy.
insert into categories (name)
values
  ('Sticker Label'),
  ('Laminated Sticker'),
  ('Tarpaulin'),
  ('Sintra Board'),
  ('General Merchandise'),
  ('3D Print')
on conflict do nothing;
