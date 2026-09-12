-- Makes the Sales-Target Bonus tier ladder admin-configurable (add/edit/delete via App Settings)
-- instead of the hardcoded 9-row `values (...)` list that previously lived inline in
-- monthly_incentive_summary()/release_monthly_incentive(). One global tier list -- editing it
-- takes effect immediately for the current month and any past month that hasn't been released
-- yet (both are always computed live); an already-released month stays frozen at its
-- monthly_incentive_releases snapshot regardless of later tier edits, same as before.
create table if not exists incentive_tiers (
  id uuid primary key default gen_random_uuid(),
  threshold numeric(12, 2) not null check (threshold > 0),
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A duplicate threshold would make "pick the highest threshold met" ambiguous.
create unique index if not exists incentive_tiers_threshold_key on incentive_tiers (threshold);

alter table incentive_tiers enable row level security;
-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

drop trigger if exists incentive_tiers_set_updated_at on incentive_tiers;
create trigger incentive_tiers_set_updated_at
  before update on incentive_tiers
  for each row
  execute function set_updated_at();

-- Seed with the ladder that was previously hardcoded, so deploying this migration doesn't change
-- anyone's current-month calculation.
insert into incentive_tiers (threshold, amount) values
  (100000, 2000),
  (150000, 2500),
  (200000, 3000),
  (250000, 3500),
  (300000, 4000),
  (350000, 4500),
  (400000, 5000),
  (450000, 5500),
  (500000, 6000)
on conflict (threshold) do nothing;

-- --- Drift reconciliation -----------------------------------------------------------------
-- Several changes below were applied directly against the live database earlier in
-- development (renaming monthly_commission_tier_summary -> monthly_incentive_summary, renaming
-- the manage_commissions permission -> manage_incentives, and adding the "current month can't be
-- released" guard to release_monthly_incentive) but were never captured as migration files, so a
-- fresh database built from this migration history alone would not have matched the live one.
-- Everything below is written to be a safe no-op on an already-patched database and correct on a
-- fresh one.

update users
set permissions = array_replace(permissions, 'manage_commissions', 'manage_incentives')
where 'manage_commissions' = any(permissions);

drop function if exists monthly_commission_tier_summary(date, date);
drop function if exists monthly_commission_tier_summary(date, date, uuid);

-- monthly_incentive_summary(): same release-aware/ownShare-resolving body as before, except the
-- tier ladder now comes from incentive_tiers instead of a hardcoded `values (...)` CTE. The "pick
-- highest threshold met" pool lookup and the per-tier progressPercent/isMet computation are
-- already agnostic to tier count/values, so nothing else changes.
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
  live_per_staff as (
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

-- release_monthly_incentive(): same current-month guard as before, tier lookup now reads from
-- incentive_tiers instead of the inline hardcoded `values (...)` subquery.
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

  select coalesce(sum(own_sales), 0) into v_total_staff_sales
  from monthly_incentive_staff_sales(p_date_from, p_date_to);

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
    from monthly_incentive_staff_sales(p_date_from, p_date_to) s
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

-- monthly_incentive_history(): unchanged behavior, just repointed at the correctly-named summary
-- function (was still calling monthly_commission_tier_summary in the last migration file).
create or replace function monthly_incentive_history(p_year int)
returns jsonb
language plpgsql
stable
as $$
declare
  v_month int;
  v_month_start date;
  v_date_to date;
  v_current_month_start date := date_trunc('month', now())::date;
  v_summary jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  for v_month in 1..12 loop
    v_month_start := make_date(p_year, v_month, 1);
    exit when v_month_start > v_current_month_start;

    v_date_to := (v_month_start + interval '1 month - 1 day')::date;
    v_summary := monthly_incentive_summary(v_month_start, v_date_to) - 'tiers' - 'perStaff' - 'ownShare';

    v_result := v_result || jsonb_build_array(
      v_summary || jsonb_build_object(
        'periodMonth', v_month_start,
        'isCurrentMonth', v_month_start = v_current_month_start
      )
    );
  end loop;

  return v_result;
end;
$$;
