-- Top customers should only reflect orders that actually represent collected, kept revenue:
-- fully paid AND not cancelled/refunded/returned. Previously this function had no status filter
-- at all, so cancelled/unpaid orders inflated a customer's total_spent/order_count.
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
      and o.payment_status = 'paid'
      and o.status not in ('cancelled', 'refunded', 'returned')
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
