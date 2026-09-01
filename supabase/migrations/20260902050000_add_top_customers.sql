-- Ranks customers by total amount spent within a trailing window (in days, passed by the
-- caller — see CUSTOMER_RANKING_WINDOW_DAYS in src/config/env.ts) for the order form's
-- customer-name combobox: the full result seeds its search suggestions, and the frontend
-- takes the top 5 for the "Top" badge.
--
-- Customer names are free text (no `customers` table), so casing/whitespace varies between
-- orders for the same real customer. Grouping on the raw string would split one customer
-- into several under-counted entries, so this groups on lower(trim(customer_name)) instead
-- and displays each group's most recent original-casing spelling.

create or replace function top_customers(p_days int)
returns jsonb
language sql
stable
as $$
  with windowed as (
    select
      lower(trim(o.customer_name)) as customer_key,
      o.customer_name,
      o.total,
      o.created_at
    from orders o
    where o.created_at >= now() - (p_days || ' days')::interval
      and o.customer_name is not null
      and trim(o.customer_name) <> ''
  ),
  grouped as (
    select
      customer_key,
      (array_agg(customer_name order by created_at desc))[1] as customer_name,
      sum(total) as total_spent,
      count(*) as order_count
    from windowed
    group by customer_key
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'customer_name', g.customer_name,
      'total_spent', g.total_spent,
      'order_count', g.order_count
    ) order by g.total_spent desc
  ), '[]'::jsonb)
  from grouped g;
$$;
