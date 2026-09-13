-- list_orders()'s p_status filter (o.status = any(p_status)) -- almost certainly the single most
-- common filter on the Orders page -- had no supporting index at all, forcing a full sequential
-- scan of `orders` on every status-filtered list call (both for the page of rows and for the
-- `total` count). Composite on (status, created_at desc) covers the filter and this endpoint's
-- default sort in one index, avoiding a separate sort step too.
create index if not exists orders_status_created_at_idx on orders (status, created_at desc);

-- order_stats(): collapses 5 full sequential scans of `orders` (3 separate group-by scans for
-- byStatus/byPaymentStatus/byChannel, a filtered sum for outstandingBalance, and a count for
-- totalOrders) into a single scan via GROUPING SETS. status/payment_status/channel are all `not
-- null` (create_order_tables.sql), so a NULL in the grouped result unambiguously marks "not part
-- of this grouping set" -- no real order data can produce a false match.
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
      sum(payment_balance) filter (where payment_status not in ('paid', 'refunded')) as outstanding_sum
    from orders
    group by grouping sets ((status), (payment_status), (channel), ())
  )
  select jsonb_build_object(
    'byStatus', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
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

-- release_monthly_incentive(): was calling monthly_incentive_staff_sales() twice -- once to get
-- the pool-qualifying total, once more in the per-staff loop -- each a real join+aggregate over
-- orders/users, not CTE reuse (this is plpgsql, so unlike the SQL-language monthly_incentive_
-- summary() case, Postgres does not materialize this for you). Computed once into a transaction-
-- scoped temp table and reused for both.
create or replace function release_monthly_incentive(p_date_from date, p_date_to date, p_actor_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_period_month date := date_trunc('month', p_date_from::timestamptz)::date;
  v_release_id uuid;
  v_total_staff_sales numeric;
  v_pool numeric;
  v_expense_id uuid;
  v_staff record;
begin
  if v_period_month >= date_trunc('month', now())::date then
    raise exception 'The current month cannot be released until it has ended.';
  end if;

  if exists (select 1 from monthly_incentive_releases where period_month = v_period_month) then
    raise exception 'The monthly incentive for this period has already been released.';
  end if;

  create temp table tmp_staff_sales on commit drop as
  select * from monthly_incentive_staff_sales(p_date_from, p_date_to);

  select coalesce(sum(own_sales), 0) into v_total_staff_sales
  from tmp_staff_sales;

  select coalesce(
    (
      select amount
      from incentive_tiers
      where v_total_staff_sales >= threshold
      order by threshold desc
      limit 1
    ),
    0
  ) into v_pool;

  if v_pool <= 0 then
    raise exception 'No incentive tier has been unlocked for this period yet.';
  end if;

  insert into monthly_incentive_releases (period_month, total_staff_sales, pool, released_by)
  values (v_period_month, v_total_staff_sales, v_pool, p_actor_id)
  returning id into v_release_id;

  for v_staff in
    select
      s.created_by,
      s.own_sales,
      s.own_sales / v_total_staff_sales * 100 as percentage_share,
      s.own_sales / v_total_staff_sales * v_pool as commission_share
    from tmp_staff_sales s
  loop
    insert into expenses (id, date, amount, category, payment_method, notes, created_by, monthly_incentive_release_id)
    values (
      gen_random_uuid(),
      current_date,
      v_staff.commission_share,
      'Payroll and Employee Costs',
      'Cash',
      'Monthly incentive — '
        || (select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) from users where id = v_staff.created_by)
        || ' (' || to_char(v_period_month, 'FMMonth YYYY') || ')',
      p_actor_id,
      v_release_id
    )
    returning id into v_expense_id;

    insert into monthly_incentive_release_shares (
      release_id, user_id, own_sales, percentage_share, commission_share, expense_id
    ) values (
      v_release_id, v_staff.created_by, v_staff.own_sales, v_staff.percentage_share, v_staff.commission_share, v_expense_id
    );
  end loop;

  return jsonb_build_object('releaseId', v_release_id, 'periodMonth', v_period_month);
end;
$$;
