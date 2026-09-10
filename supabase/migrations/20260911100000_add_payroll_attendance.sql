-- Per-entry attendance record: the specific dates (within the run's period) an admin marked as
-- worked. Empty on entries created before this feature (no attendance data recorded, distinct
-- from "explicitly marked zero days" which create_payroll_run rejects -- see below). Drives the
-- entry's amount at creation time but isn't re-derived afterward, same snapshot-once philosophy
-- as commission_released_amount / payroll amounts generally.
alter table payroll_run_entries add column if not exists worked_dates date[] not null default '{}';

-- create_payroll_run(): p_entries now carries a workedDates array per entry alongside staffId/
-- amount (amount is still whatever the client computed/decided -- day-rate math happens in the
-- UI so the admin can see and override it live; this function just validates and persists both).
-- Same signature name/shape otherwise; still plpgsql for the same atomic multi-row/multi-table
-- reasons as before. Adds a bounds check: every workedDate must fall within
-- [p_period_start, p_period_end] -- defense in depth against a client bug sending stale dates.
create or replace function create_payroll_run(
  p_period_label text,
  p_period_start date,
  p_period_end date,
  p_entries jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_run_id uuid;
  v_entry jsonb;
  v_staff_id uuid;
  v_amount numeric(10,2);
  v_worked_dates date[];
  v_staff_name text;
  v_expense_id uuid;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'p_entries must be a non-empty array';
  end if;

  insert into payroll_runs (period_label, period_start, period_end, created_by)
  values (p_period_label, p_period_start, p_period_end, p_actor_id)
  returning id into v_run_id;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_staff_id := (v_entry->>'staffId')::uuid;
    v_amount := (v_entry->>'amount')::numeric(10,2);
    select coalesce(array_agg((d)::date), '{}')
      into v_worked_dates
      from jsonb_array_elements_text(coalesce(v_entry->'workedDates', '[]'::jsonb)) as d;

    if v_staff_id is null or v_amount is null or v_amount <= 0 then
      raise exception 'each entry requires a staffId and an amount greater than 0';
    end if;
    if exists (
      select 1 from unnest(v_worked_dates) wd where wd < p_period_start or wd > p_period_end
    ) then
      raise exception 'workedDates must fall within the run period';
    end if;

    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_staff_name
    from users where id = v_staff_id;
    if v_staff_name is null then
      raise exception 'staff member % not found', v_staff_id;
    end if;

    insert into expenses (id, date, amount, category, payment_method, notes, created_by, payroll_run_id)
    values (
      gen_random_uuid(), current_date, v_amount, 'Payroll and Employee Costs', 'Cash',
      'Payroll — ' || v_staff_name || ' (' || p_period_label || ')', p_actor_id, v_run_id
    )
    returning id into v_expense_id;

    insert into payroll_run_entries (payroll_run_id, staff_id, amount, expense_id, worked_dates)
    values (v_run_id, v_staff_id, v_amount, v_expense_id, v_worked_dates);
  end loop;

  return get_payroll_run(v_run_id);
end;
$$;

-- get_payroll_run(): surface workedDates (+ a convenience workedDayCount) per entry so the run
-- detail dialog and history can show exactly which days a past run paid for.
create or replace function get_payroll_run(p_run_id uuid)
returns jsonb
language sql
stable
as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id,
    'periodLabel', r.period_label,
    'periodStart', r.period_start,
    'periodEnd', r.period_end,
    'createdBy', r.created_by,
    'createdByName', coalesce(nullif(trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')), ''), ''),
    'createdAt', r.created_at,
    'totalAmount', coalesce((select sum(e.amount) from payroll_run_entries e where e.payroll_run_id = r.id), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'staffId', e.staff_id,
        'staffName', coalesce(nullif(trim(coalesce(su.first_name, '') || ' ' || coalesce(su.last_name, '')), ''), '(deleted user)'),
        'amount', e.amount,
        'expenseId', e.expense_id,
        'workedDates', coalesce((select jsonb_agg(wd order by wd) from unnest(e.worked_dates) as wd), '[]'::jsonb),
        'workedDayCount', coalesce(array_length(e.worked_dates, 1), 0)
      ) order by su.first_name, su.last_name)
      from payroll_run_entries e
      left join users su on su.id = e.staff_id
      where e.payroll_run_id = r.id
    ), '[]'::jsonb)
  ) end
  from payroll_runs r
  left join users cu on cu.id = r.created_by
  where r.id = p_run_id;
$$;
