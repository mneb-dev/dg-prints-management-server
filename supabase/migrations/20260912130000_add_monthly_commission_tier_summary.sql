-- Monthly team-wide commission tier pool -- additive to, and entirely independent from,
-- commission_summary()'s per-order layout-fee commission (touches none of that data or the
-- release/unrelease mechanism). A fixed ladder of 9 revenue thresholds (hardcoded below, no
-- admin configurability was requested) maps a period's total STAFF-only sales to a flat monthly
-- commission pool, which is then split among staff proportional to their own contribution to
-- that total.
--
-- "Staff sales" = orders.total for orders where created_by resolves to a users row with
-- role = 'staff' (admin/superadmin-created orders are fully excluded, from both the total and
-- the pool split -- deliberately different attribution from commission_summary(), which keys
-- off layout_by instead of created_by), payment_status = 'paid', and status not in
-- ('cancelled', 'refunded', 'returned') -- the same non-cancelled/non-refunded exclusion
-- commission_summary() applies, restricted here to just the 'paid' bucket (there's no
-- unpaid/partial bucket for this feature).
--
-- Tier lookup is a ceiling, not cumulative/stacked: the pool is the fixed amount of the highest
-- threshold the period's total staff sales meets or exceeds (below the first threshold, pool =
-- 0; above the last, pool stays capped at the last tier's amount -- no extrapolation beyond it).
--
-- Split: each staff member's share of the pool is
-- (thatStaffMember'sOwnSales / totalStaffSales) * pool -- "own sales" = orders they personally
-- created (created_by), independent of who did the layout work on them.
--
-- Date args are plain `date`, compared against orders.created_at (timestamptz) as a half-open
-- [p_date_from, p_date_to + 1 day) range, same convention as commission_summary()/finance_summary().
-- The caller (routes/commissions.ts) is expected to pass the current calendar month, computed
-- client-side, to avoid server/client timezone drift -- this function itself is period-agnostic.
--
-- Returns a single jsonb object (not an array):
--   totalStaffSales -- sum of eligible orders' total for the period
--   pool             -- this period's flat commission pool (0 if below the first tier)
--   tiers            -- always all 9 tiers, each { threshold, amount, progressPercent, isMet };
--                        progressPercent = least(totalStaffSales / threshold, 1) * 100, i.e. the
--                        numerator is always the staff-only sales total, never full company sales
--   perStaff         -- one entry per staff member with >=1 eligible order, each
--                        { userId, name, ownSales, percentageShare, commissionShare },
--                        sorted by ownSales desc -- callers should hide this for staff-role
--                        callers (see routes/commissions.ts); the tiers/pool stay visible to all
create or replace function monthly_commission_tier_summary(
  p_date_from date,
  p_date_to date
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
  tiers(threshold, amount) as (
    values
      (100000::numeric, 2000::numeric),
      (150000::numeric, 2500::numeric),
      (200000::numeric, 3000::numeric),
      (250000::numeric, 3500::numeric),
      (300000::numeric, 4000::numeric),
      (350000::numeric, 4500::numeric),
      (400000::numeric, 5000::numeric),
      (450000::numeric, 5500::numeric),
      (500000::numeric, 6000::numeric)
  ),
  eligible_orders as (
    select o.total, o.created_by
    from orders o
    join users u on u.id = o.created_by
    cross join range_bounds rb
    where u.role = 'staff'
      and o.payment_status = 'paid'
      and o.status not in ('cancelled', 'refunded', 'returned')
      and o.created_at >= rb.orders_from
      and o.created_at < rb.orders_to_exclusive
  ),
  totals as (
    select coalesce(sum(total), 0) as total_staff_sales from eligible_orders
  ),
  per_staff as (
    select created_by, sum(total) as own_sales
    from eligible_orders
    group by created_by
  ),
  pool_calc as (
    select coalesce(
      (
        select t.amount
        from tiers t, totals tot
        where tot.total_staff_sales >= t.threshold
        order by t.threshold desc
        limit 1
      ),
      0
    ) as pool
  ),
  tier_rows as (
    select
      t.threshold,
      t.amount,
      least(tot.total_staff_sales / t.threshold, 1) * 100 as progress_percent,
      tot.total_staff_sales >= t.threshold as is_met
    from tiers t, totals tot
  ),
  staff_rows as (
    select
      ps.created_by,
      ps.own_sales,
      case when tot.total_staff_sales > 0
        then ps.own_sales / tot.total_staff_sales * 100 else 0 end as percentage_share,
      case when tot.total_staff_sales > 0
        then ps.own_sales / tot.total_staff_sales * pc.pool else 0 end as commission_share
    from per_staff ps, totals tot, pool_calc pc
  )
  select jsonb_build_object(
    'totalStaffSales', tot.total_staff_sales,
    'pool', pc.pool,
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'userId', sr.created_by,
          'name', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
          'ownSales', sr.own_sales,
          'percentageShare', sr.percentage_share,
          'commissionShare', sr.commission_share
        ) order by sr.own_sales desc
      ), '[]'::jsonb)
      from staff_rows sr
      join users u on u.id = sr.created_by
    )
  )
  from totals tot, pool_calc pc;
$$;
