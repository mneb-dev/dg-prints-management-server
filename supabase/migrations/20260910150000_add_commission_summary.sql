-- Per-staff commission aggregates for the Commission page. Commission = an order's layout_fee
-- times the layout_by user's commission_rate (%), applied live at read time (never snapshotted),
-- so changing a user's rate changes historical totals — same convention as layout_by_name being
-- resolved live via join.
--
-- Eligibility mirrors finance_summary()'s / top_customers()'s revenue predicate, plus dropping
-- refunded payments from every bucket (not just the paid one): an order counts only if
-- layout_by is set, status is not cancelled/refunded/returned, and payment_status is not
-- 'refunded'. Of the remaining orders: payment_status = 'paid' -> paid bucket,
-- payment_status in ('unpaid','partially_paid') -> unpaid bucket, total = paid + unpaid.
--
-- Returns a jsonb array, one row per layout_by user with at least one eligible order in range
-- (no zero-row entries), sorted by totalCommission desc. Pass p_layout_by to scope to one user
-- (returns 0 or 1 rows) -- used to force staff callers to their own id.
--
-- Date args are plain `date`, compared against orders.created_at (timestamptz) as a half-open
-- [p_date_from, p_date_to + 1 day) range, same as finance_summary().
create or replace function commission_summary(
  p_date_from date,
  p_date_to date,
  p_layout_by uuid default null
)
returns jsonb
language sql
stable
as $$
  with range_bounds as (
    select
      p_date_from::timestamptz as orders_from,
      (p_date_to + 1)::timestamptz as orders_to_exclusive
  ),
  eligible_orders as (
    select o.layout_fee, o.layout_by, o.payment_status
    from orders o, range_bounds rb
    where o.layout_by is not null
      and o.status not in ('cancelled', 'refunded', 'returned')
      and o.payment_status <> 'refunded'
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
      and (p_layout_by is null or o.layout_by = p_layout_by)
  ),
  commissioned as (
    select
      eo.layout_by,
      eo.payment_status,
      eo.layout_fee * (u.commission_rate / 100.0) as commission
    from eligible_orders eo
    join users u on u.id = eo.layout_by
  ),
  per_staff as (
    select
      layout_by,
      coalesce(sum(commission) filter (where payment_status = 'paid'), 0) as paid_commission,
      count(*) filter (where payment_status = 'paid') as paid_order_count,
      coalesce(sum(commission) filter (where payment_status in ('unpaid', 'partially_paid')), 0)
        as unpaid_commission,
      count(*) filter (where payment_status in ('unpaid', 'partially_paid')) as unpaid_order_count,
      coalesce(sum(commission), 0) as total_commission,
      count(*) as total_order_count
    from commissioned
    group by layout_by
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'layoutBy', ps.layout_by,
      'layoutByName', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
      'paidCommission', ps.paid_commission,
      'paidOrderCount', ps.paid_order_count,
      'unpaidCommission', ps.unpaid_commission,
      'unpaidOrderCount', ps.unpaid_order_count,
      'totalCommission', ps.total_commission,
      'totalOrderCount', ps.total_order_count
    ) order by ps.total_commission desc
  ), '[]'::jsonb)
  from per_staff ps
  join users u on u.id = ps.layout_by;
$$;
