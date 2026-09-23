-- order_stats(): adds `agingByStatus` for the dashboard's Order status pipeline card — per status,
-- when its longest-waiting order entered that status (`oldestAt`) and how many orders have been
-- sitting in it for 3+ / 7+ days (`over3d` / `over7d`). Computed in the same single GROUPING SETS
-- scan as the existing aggregates, so no extra pass over `orders`.
--
-- An order "entered" its current status at status_updated_at; orders that have never changed
-- status (still in their initial status) have no status_updated_at, so created_at stands in.
create or replace function order_stats()
returns jsonb
language sql
stable
as $$
  with grouped as (
    select
      status,
      payment_status,
      channel,
      count(*) as cnt,
      sum(payment_balance) filter (where payment_status not in ('paid', 'refunded')) as outstanding_sum,
      min(coalesce(status_updated_at, created_at)) as oldest_at,
      count(*) filter (where coalesce(status_updated_at, created_at) < now() - interval '3 days') as over_3d,
      count(*) filter (where coalesce(status_updated_at, created_at) < now() - interval '7 days') as over_7d
    from orders
    group by grouping sets ((status), (payment_status), (channel), ())
  )
  select jsonb_build_object(
    'byStatus', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      from grouped
      where status is not null
    ),
    'agingByStatus', (
      select coalesce(
        jsonb_object_agg(
          status,
          jsonb_build_object('oldestAt', oldest_at, 'over3d', over_3d, 'over7d', over_7d)
        ),
        '{}'::jsonb
      )
      from grouped
      where status is not null
    ),
    'byPaymentStatus', (
      select coalesce(jsonb_object_agg(payment_status, cnt), '{}'::jsonb)
      from grouped
      where payment_status is not null
    ),
    'byChannel', (
      select coalesce(jsonb_object_agg(channel, cnt), '{}'::jsonb)
      from grouped
      where channel is not null
    ),
    'outstandingBalance', (
      select coalesce(outstanding_sum, 0)
      from grouped
      where status is null and payment_status is null and channel is null
    ),
    'totalOrders', (
      select cnt
      from grouped
      where status is null and payment_status is null and channel is null
    )
  );
$$;
