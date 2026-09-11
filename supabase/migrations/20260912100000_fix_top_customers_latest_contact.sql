-- The order form's "autofill from selected customer" feature reuses this function's contact
-- fields (customer_phone, shipping_address), but the `latest` CTE was scoped to `windowed`
-- (paid, non-terminal, within the ranking window) — so a customer's shown contact info came from
-- their most recent *qualifying* order, not their actual most recent order. A brand-new
-- pending/unpaid order (the common case right after creation) or one outside the window was
-- silently skipped, surfacing stale phone/shipping data. Revenue totals/order_count stay scoped
-- to `windowed` as before; only the contact lookup now scans full order history.
create or replace function top_customers(p_days int)
returns jsonb
language sql
stable
as $$
  with windowed as (
    select
      lower(trim(o.customer_name)) as customer_key,
      o.total
    from orders o
    where o.created_at >= now() - (p_days || ' days')::interval
      and o.customer_name is not null
      and trim(o.customer_name) <> ''
      and o.payment_status = 'paid'
      and o.status not in ('cancelled', 'refunded', 'returned')
  ),
  totals as (
    select
      customer_key,
      sum(total) as total_spent,
      count(*) as order_count
    from windowed
    group by customer_key
  ),
  latest as (
    select distinct on (lower(trim(o.customer_name)))
      lower(trim(o.customer_name)) as customer_key,
      o.customer_name,
      o.customer_phone,
      o.shipping_address
    from orders o
    where o.customer_name is not null
      and trim(o.customer_name) <> ''
      and lower(trim(o.customer_name)) in (select customer_key from totals)
    order by lower(trim(o.customer_name)), o.created_at desc
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
