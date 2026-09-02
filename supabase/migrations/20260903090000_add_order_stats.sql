-- Whole-dataset order KPI aggregates for the dashboard (status/payment/channel counts,
-- outstanding AR) — unlike top_customers() this is NOT windowed, since the dashboard's
-- stat strip and breakdown cards need true totals, not a last-N-orders sample.
--
-- Each group-by result is returned as a jsonb object keyed by the group value
-- (jsonb_object_agg), not an array of {key, count} objects like top_customers' jsonb_agg —
-- there's no secondary per-group data here beyond the count, so an object maps directly
-- onto a frontend Record<string, number> with no client-side reshaping.
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
    where payment_status <> 'paid'
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
