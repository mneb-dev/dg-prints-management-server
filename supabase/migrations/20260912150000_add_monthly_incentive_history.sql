-- Business rule: the calendar month currently in progress can never be released -- its sales
-- total isn't final yet, so paying out a snapshot of it would be paying out a number that's still
-- moving. Enforced here (not just hidden in the UI) so a direct API call can't bypass it either.
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
      from (values
        (100000::numeric, 2000::numeric), (150000::numeric, 2500::numeric), (200000::numeric, 3000::numeric),
        (250000::numeric, 3500::numeric), (300000::numeric, 4000::numeric), (350000::numeric, 4500::numeric),
        (400000::numeric, 5000::numeric), (450000::numeric, 5500::numeric), (500000::numeric, 6000::numeric)
      ) as t(threshold, amount)
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

-- Admin/superadmin history view: one row per calendar month of p_year (Jan through either Dec, or
-- the current month if p_year is the current year -- later months in the current year don't exist
-- yet). Reuses monthly_commission_tier_summary for each month's totals/pool/release status,
-- stripped of the heavy tiers/perStaff/ownShare arrays (irrelevant for a list view) via the jsonb
-- `-` (remove key) operator, plus an isCurrentMonth flag so the frontend can grey out/hide the
-- release action for the one month that release_monthly_incentive will always refuse anyway.
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
    v_summary := monthly_commission_tier_summary(v_month_start, v_date_to) - 'tiers' - 'perStaff' - 'ownShare';

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
