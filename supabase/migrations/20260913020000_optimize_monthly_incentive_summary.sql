-- monthly_incentive_summary() referenced the live_per_staff CTE (which calls
-- monthly_incentive_staff_sales() -- a join+aggregate over orders/users) from both live_totals
-- and live_staff_rows. A plain CTE isn't cached across references, so that scan ran twice per
-- call. Marking it `materialized` forces single evaluation; same query, same results, half the
-- underlying work. (Also benefits from orders_paid_revenue_idx/orders_created_by_idx added in
-- 20260913010000_add_orders_report_indexes.sql, which this function's filters match.)
create or replace function monthly_incentive_summary(
  p_date_from date,
  p_date_to date,
  p_caller_id uuid default null
)
returns jsonb
language sql
stable
as $$
  with period_month as (
    select date_trunc('month', p_date_from::timestamptz)::date as month
  ),
  release_row as (
    select r.*
    from monthly_incentive_releases r, period_month pm
    where r.period_month = pm.month
  ),
  tiers as (
    select threshold, amount from incentive_tiers
  ),
  live_per_staff as materialized (
    select * from monthly_incentive_staff_sales(p_date_from, p_date_to)
  ),
  live_totals as (
    select coalesce(sum(own_sales), 0) as total_staff_sales from live_per_staff
  ),
  live_pool_calc as (
    select coalesce(
      (
        select t.amount
        from tiers t, live_totals lt
        where lt.total_staff_sales >= t.threshold
        order by t.threshold desc
        limit 1
      ),
      0
    ) as pool
  ),
  effective as (
    select
      coalesce(rr.total_staff_sales, lt.total_staff_sales) as total_staff_sales,
      coalesce(rr.pool, pc.pool) as pool,
      rr.id as release_id,
      rr.released_at,
      rr.released_by
    from live_totals lt, live_pool_calc pc
    left join release_row rr on true
  ),
  tier_rows as (
    select
      t.threshold,
      t.amount,
      least(e.total_staff_sales / t.threshold, 1) * 100 as progress_percent,
      e.total_staff_sales >= t.threshold as is_met
    from tiers t, effective e
  ),
  live_staff_rows as (
    select
      lps.created_by,
      lps.own_sales,
      case when lt.total_staff_sales > 0 then lps.own_sales / lt.total_staff_sales * 100 else 0 end
        as percentage_share,
      case when lt.total_staff_sales > 0 then lps.own_sales / lt.total_staff_sales * pc.pool else 0 end
        as commission_share
    from live_per_staff lps, live_totals lt, live_pool_calc pc
  ),
  released_staff_rows as (
    select s.user_id as created_by, s.own_sales, s.percentage_share, s.commission_share
    from monthly_incentive_release_shares s
    join release_row rr on rr.id = s.release_id
  )
  select jsonb_build_object(
    'totalStaffSales', e.total_staff_sales,
    'pool', e.pool,
    'tiers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'threshold', tr.threshold,
          'amount', tr.amount,
          'progressPercent', tr.progress_percent,
          'isMet', tr.is_met
        ) order by tr.threshold asc
      ), '[]'::jsonb)
      from tier_rows tr
    ),
    'perStaff', (
      case when e.release_id is not null then (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'userId', rsr.created_by,
            'name', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
            'ownSales', rsr.own_sales,
            'percentageShare', rsr.percentage_share,
            'commissionShare', rsr.commission_share
          ) order by rsr.own_sales desc
        ), '[]'::jsonb)
        from released_staff_rows rsr
        left join users u on u.id = rsr.created_by
      )
      else (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'userId', lsr.created_by,
            'name', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
            'ownSales', lsr.own_sales,
            'percentageShare', lsr.percentage_share,
            'commissionShare', lsr.commission_share
          ) order by lsr.own_sales desc
        ), '[]'::jsonb)
        from live_staff_rows lsr
        join users u on u.id = lsr.created_by
      )
    end
    ),
    'ownShare', (
      case when e.release_id is not null then (
        select jsonb_build_object(
          'ownSales', rsr.own_sales, 'percentageShare', rsr.percentage_share, 'commissionShare', rsr.commission_share
        )
        from released_staff_rows rsr
        where rsr.created_by = p_caller_id
      )
      else (
        select jsonb_build_object(
          'ownSales', lsr.own_sales, 'percentageShare', lsr.percentage_share, 'commissionShare', lsr.commission_share
        )
        from live_staff_rows lsr
        where lsr.created_by = p_caller_id
      )
      end
    ),
    'releasedAt', e.released_at,
    'releasedBy', e.released_by,
    'releasedByName', (
      select coalesce(nullif(trim(coalesce(u2.first_name, '') || ' ' || coalesce(u2.last_name, '')), ''), '')
      from users u2
      where u2.id = e.released_by
    )
  )
  from effective e;
$$;
