-- Per-order commission release tracking: admin marks a paid order's layout commission as
-- "released" (handed over to the staff member) so weekly payouts can be tracked precisely,
-- separately from payment_status. commission_released_by is set-null on user deletion so a
-- historical release record isn't lost if the releasing admin's account is later removed.
alter table orders add column if not exists commission_released_at timestamptz;
alter table orders add column if not exists commission_released_by uuid references users(id) on delete set null;
-- Locked-in commission amount as of release time (layout_fee * that staff's commission_rate at
-- that moment). Null while unreleased; unreleased orders keep computing live from the current
-- rate, same as before this feature existed -- so a later commission_rate edit can't silently
-- change what an already-paid-out order shows as owed.
alter table orders add column if not exists commission_released_amount numeric(10,2);

-- Speeds up "release all pending" scans (paid orders with no release yet) and the
-- released/pending-release aggregates in commission_summary().
create index if not exists idx_orders_commission_release
  on orders (layout_by, commission_released_at)
  where payment_status = 'paid';

-- release_commission_orders(): atomically releases a batch of paid, not-yet-released orders,
-- computing and locking in each one's commission amount from the *current* commission_rate of
-- its layout_by user in the same statement (avoids a read-then-write race with a concurrent rate
-- edit). Orders that don't match payment_status = 'paid' or are already released are silently
-- skipped (idempotent -- re-releasing an already-released order is a no-op, not a re-stamp, so
-- its locked-in amount never drifts to a possibly-different current rate on a repeat call).
-- Returns the ids actually released, so the caller can detect a partial release.
create or replace function release_commission_orders(p_order_ids uuid[], p_actor_id uuid)
returns jsonb
language sql
as $$
  with updated as (
    update orders o
    set commission_released_at = now(),
        commission_released_by = p_actor_id,
        commission_released_amount = o.layout_fee * (u.commission_rate / 100.0)
    from users u
    where o.id = any(p_order_ids)
      and o.layout_by = u.id
      and o.payment_status = 'paid'
      and o.commission_released_at is null
    returning o.id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) from updated;
$$;

-- commission_summary(): additive fields only, same signature/parameter order (required for
-- create or replace function -- see 20260902080000_add_user_status.sql's comment). Splits the
-- existing paid bucket into released vs pending-release. Released orders use the snapshotted
-- commission_released_amount; unreleased orders keep computing live from the current rate.
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
