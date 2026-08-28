-- Product catalog schema: products, their options (with values), and pricing.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  description text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  required boolean not null default false,
  sort_order int not null default 0
);

create index if not exists product_options_product_id_idx
  on product_options (product_id);

create table if not exists product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references product_options (id) on delete cascade,
  value text not null,
  sort_order int not null default 0
);

create index if not exists product_option_values_option_id_idx
  on product_option_values (option_id);

create table if not exists product_pricing (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  applies_to text not null default 'All',
  pricing_type text not null default 'Package',
  package_name text,
  price numeric(10, 2) not null default 0,
  unit text not null default 'Package',
  sort_order int not null default 0
);

create index if not exists product_pricing_product_id_idx
  on product_pricing (product_id);

alter table products enable row level security;
alter table product_options enable row level security;
alter table product_option_values enable row level security;
alter table product_pricing enable row level security;

-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row
  execute function set_updated_at();

-- Atomically upserts a product and its options/pricing/values from a single
-- JSON payload. Called for both create and update: the caller (application
-- code) has already resolved every id (fresh ids on create, preserved ids
-- on update), so this function just needs to sync tables to match the
-- payload — upserting entries present in it and deleting ones that aren't.
--
-- Expected payload shape (all ids required, snake_case):
-- {
--   "id": uuid, "name": text, "category": text, "description": text, "status": text,
--   "options": [{ "id": uuid, "name": text, "required": bool, "sort_order": int,
--                 "values": [{ "id": uuid, "value": text, "sort_order": int }] }],
--   "pricing": [{ "id": uuid, "applies_to": text, "pricing_type": text,
--                 "package_name": text|null, "price": number, "unit": text, "sort_order": int }]
-- }
create or replace function upsert_product(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  v_option_ids uuid[];
  v_pricing_ids uuid[];
  opt jsonb;
  val jsonb;
  prc jsonb;
begin
  insert into products (id, name, category, description, status)
  values (
    v_product_id,
    payload->>'name',
    coalesce(payload->>'category', ''),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'status', 'Active')
  )
  on conflict (id) do update set
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    status = excluded.status;

  select coalesce(array_agg((o->>'id')::uuid), '{}')
    into v_option_ids
    from jsonb_array_elements(coalesce(payload->'options', '[]'::jsonb)) o;

  delete from product_options
   where product_id = v_product_id
     and id != all (v_option_ids);

  for opt in select * from jsonb_array_elements(coalesce(payload->'options', '[]'::jsonb))
  loop
    insert into product_options (id, product_id, name, required, sort_order)
    values (
      (opt->>'id')::uuid,
      v_product_id,
      opt->>'name',
      coalesce((opt->>'required')::boolean, false),
      coalesce((opt->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      name = excluded.name,
      required = excluded.required,
      sort_order = excluded.sort_order;

    delete from product_option_values where option_id = (opt->>'id')::uuid;

    for val in select * from jsonb_array_elements(coalesce(opt->'values', '[]'::jsonb))
    loop
      insert into product_option_values (id, option_id, value, sort_order)
      values (
        coalesce((val->>'id')::uuid, gen_random_uuid()),
        (opt->>'id')::uuid,
        val->>'value',
        coalesce((val->>'sort_order')::int, 0)
      );
    end loop;
  end loop;

  select coalesce(array_agg((p->>'id')::uuid), '{}')
    into v_pricing_ids
    from jsonb_array_elements(coalesce(payload->'pricing', '[]'::jsonb)) p;

  delete from product_pricing
   where product_id = v_product_id
     and id != all (v_pricing_ids);

  for prc in select * from jsonb_array_elements(coalesce(payload->'pricing', '[]'::jsonb))
  loop
    insert into product_pricing (id, product_id, applies_to, pricing_type, package_name, price, unit, sort_order)
    values (
      (prc->>'id')::uuid,
      v_product_id,
      coalesce(prc->>'applies_to', 'All'),
      coalesce(prc->>'pricing_type', 'Package'),
      prc->>'package_name',
      coalesce((prc->>'price')::numeric, 0),
      coalesce(prc->>'unit', 'Package'),
      coalesce((prc->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      applies_to = excluded.applies_to,
      pricing_type = excluded.pricing_type,
      package_name = excluded.package_name,
      price = excluded.price,
      unit = excluded.unit,
      sort_order = excluded.sort_order;
  end loop;

  return v_product_id;
end;
$$;
