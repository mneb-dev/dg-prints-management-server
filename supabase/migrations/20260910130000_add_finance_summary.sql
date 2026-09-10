-- Cash-basis Finance report aggregates (Net Profit = collected order revenue minus logged
-- expenses) for the admin/superadmin-only Finance page. Revenue counts only orders that
-- represent collected, kept money — same predicate as top_customers()
-- (20260905180000_exclude_unpaid_and_terminal_orders_from_top_customers.sql):
-- payment_status = 'paid' and status not in ('cancelled', 'refunded', 'returned').
-- No cost/COGS columns exist on orders, so "profit" here is purely
-- revenue-in minus expenses-out over the range, not a true margin.
--
-- Date args are plain `date`: orders.created_at is timestamptz and gets compared against a
-- half-open [p_date_from, p_date_to + 1 day) range in the database's session timezone;
-- expenses.date is itself a plain `date` column and is compared directly, inclusive both ends.
--
-- `series` buckets revenue/expenses by day within the range for the page's dual-series trend
-- chart, bucketed in SQL (unlike sales-chart-card.tsx's client-side bucketing) since expenses
-- aren't otherwise fetched into Redux in bulk. The route caps the allowed range to keep this
-- array small.
create or replace function finance_summary(p_date_from date, p_date_to date)
returns jsonb
language sql
stable
as $$
  with range_bounds as (
    select
      p_date_from::timestamptz as orders_from,
      (p_date_to + 1)::timestamptz as orders_to_exclusive
  ),
  revenue_orders as (
    select o.id, o.total, o.created_at, o.channel, o.payment_method
    from orders o, range_bounds rb
    where o.payment_status = 'paid'
      and o.status not in ('cancelled', 'refunded', 'returned')
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
  ),
  range_expenses as (
    select e.id, e.amount, e.date, e.category, e.payment_method
    from expenses e
    where e.date >= p_date_from and e.date <= p_date_to
  ),
  revenue_total as (
    select coalesce(sum(total), 0) as total, count(*) as cnt from revenue_orders
  ),
  expense_total as (
    select coalesce(sum(amount), 0) as total, count(*) as cnt from range_expenses
  ),
  outstanding as (
    -- Same predicate as order_stats()'s outstandingBalance, scoped to this date range so it
    -- lines up with the KPI row's range selector.
    select coalesce(sum(o.payment_balance), 0) as total
    from orders o, range_bounds rb
    where o.payment_status not in ('paid', 'refunded')
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
  ),
  expenses_by_category as (
    select coalesce(jsonb_object_agg(category, total), '{}'::jsonb) as obj
    from (
      select category, sum(amount) as total
      from range_expenses
      group by category
    ) s
  ),
  revenue_by_channel as (
    select coalesce(jsonb_object_agg(channel, total), '{}'::jsonb) as obj
    from (
      select channel, sum(total) as total
      from revenue_orders
      group by channel
    ) s
  ),
  revenue_by_payment_method as (
    select coalesce(jsonb_object_agg(coalesce(payment_method, 'unspecified'), total), '{}'::jsonb) as obj
    from (
      select payment_method, sum(total) as total
      from revenue_orders
      group by payment_method
    ) s
  ),
  days as (
    select generate_series(p_date_from, p_date_to, interval '1 day')::date as d
  ),
  revenue_by_day as (
    select d.d as day, coalesce(sum(ro.total), 0) as total
    from days d
    left join revenue_orders ro on ro.created_at::date = d.d
    group by d.d
  ),
  expenses_by_day as (
    select d.d as day, coalesce(sum(re.amount), 0) as total
    from days d
    left join range_expenses re on re.date = d.d
    group by d.d
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'totalRevenue', (select total from revenue_total),
    'revenueOrderCount', (select cnt from revenue_total),
    'totalExpenses', (select total from expense_total),
    'expenseCount', (select cnt from expense_total),
    'netProfit', (select total from revenue_total) - (select total from expense_total),
    'outstandingBalance', (select total from outstanding),
    'expensesByCategory', (select obj from expenses_by_category),
    'revenueByChannel', (select obj from revenue_by_channel),
    'revenueByPaymentMethod', (select obj from revenue_by_payment_method),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', rd.day,
        'revenue', rd.total,
        'expenses', ed.total
      ) order by rd.day), '[]'::jsonb)
      from revenue_by_day rd
      join expenses_by_day ed on ed.day = rd.day
    )
  );
$$;
