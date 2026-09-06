-- Excludes refunded orders from the outstanding-AR total, now that "refunded" is a real
-- payment_status value (previously only "unpaid"/"partially_paid"/"paid" existed) — a refunded
-- order's payment_balance shouldn't be chased as outstanding receivable.
create or replace function order_stats()
returns jsonb
language sql
stable
as $$
  with by_status as (
    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) as obj
    from (select status, count(*) as cnt from orders group by status) s
  ),
  by_payment_status as (
    select coalesce(jsonb_object_agg(payment_status, cnt), '{}'::jsonb) as obj
    from (select payment_status, count(*) as cnt from orders group by payment_status) s
  ),
  by_channel as (
    select coalesce(jsonb_object_agg(channel, cnt), '{}'::jsonb) as obj
    from (select channel, count(*) as cnt from orders group by channel) s
  ),
  outstanding as (
    select coalesce(sum(payment_balance), 0) as total
    from orders
    where payment_status not in ('paid', 'refunded')
  ),
  totals as (
    select count(*) as total from orders
  )
  select jsonb_build_object(
    'byStatus', (select obj from by_status),
    'byPaymentStatus', (select obj from by_payment_status),
    'byChannel', (select obj from by_channel),
    'outstandingBalance', (select total from outstanding),
    'totalOrders', (select total from totals)
  );
$$;
