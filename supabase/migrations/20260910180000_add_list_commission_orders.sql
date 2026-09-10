-- Per-order commission detail backing the Commissions page's order table (release/unrelease
-- actions operate on individual orders returned here). Same eligible_orders predicate/date
-- range as commission_summary() -- see that function's comment for the eligibility rules.
-- commissionAmount uses the same snapshot-or-live logic as commission_summary(): the locked-in
-- commission_released_amount once released, otherwise computed live from the current rate.
-- layoutByName/releasedByName are resolved live via join, never snapshotted (only the amount is
-- snapshotted, at release time) -- same convention as list_orders' layout_by_name.
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
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', eo.id,
      'orderNumber', eo.order_number,
      'customerName', eo.customer_name,
      'layoutFee', eo.layout_fee,
      'commissionRate', u.commission_rate,
      'commissionAmount', case
        when eo.commission_released_at is not null then eo.commission_released_amount
        else eo.layout_fee * (u.commission_rate / 100.0)
      end,
      'paymentStatus', eo.payment_status,
      'layoutBy', eo.layout_by,
      'layoutByName', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
      'createdAt', eo.created_at,
      'releasedAt', eo.commission_released_at,
      'releasedBy', eo.commission_released_by,
      'releasedByName', case when eo.commission_released_by is null then null
        else coalesce(nullif(trim(coalesce(ru.first_name, '') || ' ' || coalesce(ru.last_name, '')), ''), '') end
    ) order by eo.created_at desc
  ), '[]'::jsonb)
  from eligible_orders eo
  join users u on u.id = eo.layout_by
  left join users ru on ru.id = eo.commission_released_by;
$$;
