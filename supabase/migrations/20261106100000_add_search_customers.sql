-- The order form's Customer Name suggestions used top_customers(), which only returns customers
-- with paid, non-terminal orders inside the 30-day ranking window — so anyone whose orders were
-- older, unpaid or still pending (every brand-new order) never showed up as a suggestion, even
-- though order search found them. search_customers() looks across ALL order history, any status,
-- and matches the typed text anywhere in the name (case-insensitive). top_customers() is left
-- unchanged for the dashboard's Top customers card and the "Top" badge.
--
-- Same row shape as top_customers(): contact fields come from the customer's most recent order
-- (uses orders_customer_key_created_at_idx); total_spent/order_count are all-time, excluding
-- cancelled/refunded/returned orders. Ranking: exact name match, then names starting with the
-- query, then most recently ordered.
create or replace function search_customers(p_query text, p_limit int default 20)
returns jsonb
language sql
stable
as $$
  with q as (
    -- Escape LIKE wildcards so a typed % or _ matches literally.
    select
      lower(trim(coalesce(p_query, ''))) as raw,
      replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') as needle
  ),
  latest as (
    select distinct on (lower(trim(o.customer_name)))
      lower(trim(o.customer_name)) as customer_key,
      o.customer_name,
      o.customer_phone,
      o.shipping_address,
      o.created_at as last_order_at
    from orders o, q
    where o.customer_name is not null
      and trim(o.customer_name) <> ''
      and lower(trim(o.customer_name)) like '%' || q.needle || '%'
    order by lower(trim(o.customer_name)), o.created_at desc
  ),
  picked as (
    select l.*
    from latest l, q
    order by
      (l.customer_key = q.raw) desc,
      (l.customer_key like q.needle || '%') desc,
      l.last_order_at desc
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  totals as (
    select
      lower(trim(o.customer_name)) as customer_key,
      sum(o.total) as total_spent,
      count(*) as order_count
    from orders o
    where lower(trim(o.customer_name)) in (select customer_key from picked)
      and o.status not in ('cancelled', 'refunded', 'returned')
    group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'customer_name', p.customer_name,
      'customer_phone', p.customer_phone,
      'shipping_address', p.shipping_address,
      'total_spent', coalesce(t.total_spent, 0),
      'order_count', coalesce(t.order_count, 0)
    ) order by (p.customer_key = q.raw) desc, (p.customer_key like q.needle || '%') desc, p.last_order_at desc
  ), '[]'::jsonb)
  from picked p
  cross join q
  left join totals t using (customer_key);
$$;
