-- Order schema: orders, their line items, and a server-owned order-number sequence.

create sequence if not exists orders_order_number_seq;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique
    default ('ORD-' || lpad(nextval('orders_order_number_seq')::text, 3, '0')),
  customer_name text not null default '',
  customer_phone text not null default '',
  status text not null default 'pending',
  subtotal numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  notes text not null default '',
  channel text not null default '',
  additional_fees numeric(10, 2) not null default 0,
  shipping_address jsonb,
  payment_status text not null default '',
  payment_method text,
  payment_down_payment numeric(10, 2) not null default 0,
  payment_balance numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter sequence orders_order_number_seq owned by orders.order_number;

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id),
  product_name text not null default '',
  product_category text not null default '',
  selected_options jsonb not null default '[]'::jsonb,
  quantity int not null default 1,
  notes text not null default '',
  pricing jsonb not null default '{}'::jsonb,
  line_total numeric(10, 2) not null default 0,
  sticker_quotation jsonb,
  sort_order int not null default 0
);

create index if not exists order_items_order_id_idx on order_items (order_id);
create index if not exists order_items_product_id_idx on order_items (product_id);

alter table orders enable row level security;
alter table order_items enable row level security;

-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
  before update on orders
  for each row
  execute function set_updated_at();

-- Atomically upserts an order and its line items from a single JSON payload.
-- Called for both create and update: the caller has already resolved every
-- item id (fresh ids on create, preserved ids on update), so this function
-- just needs to sync order_items to match the payload — upserting entries
-- present in it and deleting ones that aren't. `order_number` is
-- intentionally never referenced here: the column default assigns it on
-- first insert, and omitting it from the on-conflict `set` clause leaves it
-- untouched on every subsequent update, so a client-supplied value in the
-- payload can never overwrite it.
--
-- Expected payload shape (all ids required, snake_case):
-- {
--   "id": uuid, "customer_name": text, "customer_phone": text, "status": text,
--   "subtotal": number, "discount": number, "total": number, "notes": text,
--   "channel": text, "additional_fees": number, "shipping_address": jsonb|null,
--   "payment_status": text, "payment_method": text|null,
--   "payment_down_payment": number, "payment_balance": number,
--   "items": [{ "id": uuid, "product_id": uuid, "product_name": text,
--               "product_category": text, "selected_options": jsonb,
--               "quantity": int, "notes": text, "pricing": jsonb,
--               "line_total": number, "sticker_quotation": jsonb|null,
--               "sort_order": int }]
-- }
create or replace function upsert_order(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid := (payload->>'id')::uuid;
  v_item_ids uuid[];
  itm jsonb;
begin
  insert into orders (
    id, customer_name, customer_phone, status, subtotal, discount, total,
    notes, channel, additional_fees, shipping_address,
    payment_status, payment_method, payment_down_payment, payment_balance
  )
  values (
    v_order_id,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    coalesce(payload->>'status', 'pending'),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'discount')::numeric, 0),
    coalesce((payload->>'total')::numeric, 0),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'channel', ''),
    coalesce((payload->>'additional_fees')::numeric, 0),
    payload->'shipping_address',
    coalesce(payload->>'payment_status', ''),
    payload->>'payment_method',
    coalesce((payload->>'payment_down_payment')::numeric, 0),
    coalesce((payload->>'payment_balance')::numeric, 0)
  )
  on conflict (id) do update set
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    status = excluded.status,
    subtotal = excluded.subtotal,
    discount = excluded.discount,
    total = excluded.total,
    notes = excluded.notes,
    channel = excluded.channel,
    additional_fees = excluded.additional_fees,
    shipping_address = excluded.shipping_address,
    payment_status = excluded.payment_status,
    payment_method = excluded.payment_method,
    payment_down_payment = excluded.payment_down_payment,
    payment_balance = excluded.payment_balance;

  select coalesce(array_agg((i->>'id')::uuid), '{}')
    into v_item_ids
    from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) i;

  delete from order_items
   where order_id = v_order_id
     and id != all (v_item_ids);

  for itm in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into order_items (
      id, order_id, product_id, product_name, product_category,
      selected_options, quantity, notes, pricing, line_total,
      sticker_quotation, sort_order
    )
    values (
      (itm->>'id')::uuid,
      v_order_id,
      (itm->>'product_id')::uuid,
      coalesce(itm->>'product_name', ''),
      coalesce(itm->>'product_category', ''),
      coalesce(itm->'selected_options', '[]'::jsonb),
      coalesce((itm->>'quantity')::int, 1),
      coalesce(itm->>'notes', ''),
      coalesce(itm->'pricing', '{}'::jsonb),
      coalesce((itm->>'line_total')::numeric, 0),
      itm->'sticker_quotation',
      coalesce((itm->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      product_category = excluded.product_category,
      selected_options = excluded.selected_options,
      quantity = excluded.quantity,
      notes = excluded.notes,
      pricing = excluded.pricing,
      line_total = excluded.line_total,
      sticker_quotation = excluded.sticker_quotation,
      sort_order = excluded.sort_order;
  end loop;

  return v_order_id;
end;
$$;
