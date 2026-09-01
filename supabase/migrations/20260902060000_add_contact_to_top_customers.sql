-- Extends top_customers() to also return each customer's last-known contact/shipping info,
-- so the order form can auto-fill Phone + shipping name/phone/address when staff pick a
-- suggested customer from the combobox (see src/components/orders/order-form.tsx).
--
-- customer_name/customer_phone/shipping_address must come from the SAME latest order row —
-- pulling each column independently (e.g. separate array_aggs) could mix fields from
-- different orders for the same customer. `distinct on` guarantees a single consistent row.

create or replace function top_customers(p_days int)
returns jsonb
language sql
stable
as $$
  with windowed as (
    select
      lower(trim(o.customer_name)) as customer_key,
      o.customer_name,
      o.customer_phone,
      o.shipping_address,
      o.total,
      o.created_at
    from orders o
    where o.created_at >= now() - (p_days || ' days')::interval
      and o.customer_name is not null
      and trim(o.customer_name) <> ''
  ),
  latest as (
    select distinct on (customer_key)
      customer_key, customer_name, customer_phone, shipping_address
    from windowed
    order by customer_key, created_at desc
  ),
  totals as (
    select
      customer_key,
      sum(total) as total_spent,
      count(*) as order_count
    from windowed
    group by customer_key
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'customer_name', l.customer_name,
      'customer_phone', l.customer_phone,
      'shipping_address', l.shipping_address,
      'total_spent', t.total_spent,
      'order_count', t.order_count
    ) order by t.total_spent desc
  ), '[]'::jsonb)
  from latest l
  join totals t using (customer_key);
$$;
