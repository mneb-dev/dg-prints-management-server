-- Online shop payments (PayMongo Checkout Sessions).
--
-- A fully-priced shop cart is not turned into an order straight away: it is frozen here as the
-- exact upsert_order payload, the buyer pays on PayMongo's hosted page, and only then does
-- complete_shop_checkout() create the order as paid. Abandoned payments leave no order behind.

create table if not exists shop_checkouts (
  id uuid primary key,
  order_payload jsonb not null,
  total numeric(10, 2) not null,
  status text not null default 'pending', -- pending | paid | expired
  paymongo_checkout_session_id text unique,
  checkout_url text,
  paymongo_payment_id text unique,
  payment_method text,
  amount_paid numeric(10, 2),
  order_id uuid references orders (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  -- For the portal's "Check payment" search (buyer says they were charged but no order shows up).
  customer_name text generated always as (order_payload->>'customer_name') stored,
  customer_phone_digits text generated always as (regexp_replace(order_payload->>'customer_phone', '\D', '', 'g')) stored
);

alter table shop_checkouts enable row level security;
create index if not exists shop_checkouts_created_at_idx on shop_checkouts (created_at desc);

-- Called by both the PayMongo webhook and the shop's return page, possibly at the same time:
-- the row lock makes sure only one of them creates the order, and repeat calls just return it.
create or replace function complete_shop_checkout(
  p_checkout_id uuid,
  p_payment_id text,
  p_method text,
  p_amount numeric
)
returns uuid
language plpgsql
as $$
declare
  v_checkout shop_checkouts%rowtype;
  v_order_id uuid;
begin
  select * into v_checkout from shop_checkouts where id = p_checkout_id for update;
  if not found then
    raise exception 'Checkout % not found', p_checkout_id;
  end if;
  if v_checkout.status = 'paid' then
    return v_checkout.order_id;
  end if;

  v_order_id := upsert_order(
    v_checkout.order_payload || jsonb_build_object(
      'payment_status', case when p_amount >= v_checkout.total then 'paid' else 'partially_paid' end,
      'payment_method', p_method,
      'payment_down_payment', least(p_amount, v_checkout.total),
      'payment_balance', greatest(v_checkout.total - p_amount, 0),
      'created_at', now(),
      'status_updated_at', now()
    )
  );

  update shop_checkouts set
    status = 'paid',
    order_id = v_order_id,
    paymongo_payment_id = p_payment_id,
    payment_method = p_method,
    amount_paid = p_amount,
    paid_at = now()
  where id = p_checkout_id;

  return v_order_id;
end;
$;

-- This function marks a checkout paid and creates the order, so only the server (service role) may
-- call it — Supabase otherwise lets the public anon/authenticated API roles execute functions.
revoke execute on function complete_shop_checkout(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function complete_shop_checkout(uuid, text, text, numeric) to service_role;

-- Methods PayMongo can report that the seeded list (GCash, Cash, Maya, Bank Transfer, Card) lacks.
insert into payment_methods (name, sort_order)
select m.name, (select coalesce(max(sort_order), -1) from payment_methods) + m.ord
from (values ('GrabPay', 1), ('QR Ph', 2), ('Online banking', 3)) as m(name, ord)
where not exists (select 1 from payment_methods p where lower(p.name) = lower(m.name));

-- Same columns again for databases that ran an earlier draft of this migration, where the table
-- already existed without them (create table if not exists won't add columns).
alter table shop_checkouts
  add column if not exists customer_name text
    generated always as (order_payload->>'customer_name') stored,
  add column if not exists customer_phone_digits text
    generated always as (regexp_replace(order_payload->>'customer_phone', '\D', '', 'g')) stored;
