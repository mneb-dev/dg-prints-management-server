-- Hide orders that earn no commission from the Layout commission tab: an order only needs a
-- layout_by to be eligible, so one with no layout fee (or a staff member on a 0% rate) showed up
-- as a ₱0.00 row and was counted in the order totals. Both functions now drop rows whose
-- commission (the released snapshot, else layout_fee * current rate -- same logic as before) is
-- not above zero. Same signatures and parameter order as 20260910170000 / 20260910180000, so
-- create or replace keeps working and the server needs no change. Because list_commission_orders
-- feeds the server's pendingReleaseIds, "Release all pending" no longer picks these orders up
-- either.

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
    select o.layout_fee, o.layout_by, o.payment_status,
           o.commission_released_at, o.commission_released_amount
    from orders o, range_bounds rb
    where o.layout_by is not null
      and o.status not in ('cancelled', 'refunded', 'returned')
      and o.payment_status <> 'refunded'
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
      and (p_layout_by is null or o.layout_by = p_layout_by)
  ),
  commissioned as (
    select *
    from (
      select
        eo.layout_by,
        eo.payment_status,
        eo.commission_released_at,
        case
          when eo.commission_released_at is not null then eo.commission_released_amount
          else eo.layout_fee * (u.commission_rate / 100.0)
        end as commission
      from eligible_orders eo
      join users u on u.id = eo.layout_by
    ) c
    where c.commission > 0
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
      count(*) as total_order_count,
      coalesce(sum(commission) filter (
        where payment_status = 'paid' and commission_released_at is not null), 0) as released_commission,
      count(*) filter (
        where payment_status = 'paid' and commission_released_at is not null) as released_order_count,
      coalesce(sum(commission) filter (
        where payment_status = 'paid' and commission_released_at is null), 0) as pending_release_commission,
      count(*) filter (
        where payment_status = 'paid' and commission_released_at is null) as pending_release_order_count
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
      'totalOrderCount', ps.total_order_count,
      'releasedCommission', ps.released_commission,
      'releasedOrderCount', ps.released_order_count,
      'pendingReleaseCommission', ps.pending_release_commission,
      'pendingReleaseOrderCount', ps.pending_release_order_count
    ) order by ps.total_commission desc
  ), '[]'::jsonb)
  from per_staff ps
  join users u on u.id = ps.layout_by;
$$;

create or replace function list_commission_orders(
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
    select o.*
    from orders o, range_bounds rb
    where o.layout_by is not null
      and o.status not in ('cancelled', 'refunded', 'returned')
      and o.payment_status <> 'refunded'
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
      and (p_layout_by is null or o.layout_by = p_layout_by)
  ),
  commissioned as (
    select eo.*, u.commission_rate, u.first_name, u.last_name,
      case
        when eo.commission_released_at is not null then eo.commission_released_amount
        else eo.layout_fee * (u.commission_rate / 100.0)
      end as commission_amount
    from eligible_orders eo
    join users u on u.id = eo.layout_by
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', co.id,
      'orderNumber', co.order_number,
      'customerName', co.customer_name,
      'layoutFee', co.layout_fee,
      'commissionRate', co.commission_rate,
      'commissionAmount', co.commission_amount,
      'paymentStatus', co.payment_status,
      'layoutBy', co.layout_by,
      'layoutByName', coalesce(nullif(trim(coalesce(co.first_name, '') || ' ' || coalesce(co.last_name, '')), ''), ''),
      'createdAt', co.created_at,
      'releasedAt', co.commission_released_at,
      'releasedBy', co.commission_released_by,
      'releasedByName', case when co.commission_released_by is null then null
        else coalesce(nullif(trim(coalesce(ru.first_name, '') || ' ' || coalesce(ru.last_name, '')), ''), '') end
    ) order by co.created_at desc
  ), '[]'::jsonb)
  from commissioned co
  left join users ru on ru.id = co.commission_released_by
  where co.commission_amount > 0;
$$;
