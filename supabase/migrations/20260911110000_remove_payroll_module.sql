-- Full teardown of the standalone Payroll module (page/routes/tables) -- replaced by a simple
-- "Run Payroll" action on the Expenses page that creates ordinary expenses directly, no
-- dedicated payroll schema needed anymore.
drop function if exists create_payroll_run(text, date, date, jsonb, uuid);
drop function if exists get_payroll_run(uuid);
drop function if exists list_payroll_runs(uuid, int, int);

alter table expenses drop column if exists payroll_run_id;
drop table if exists payroll_run_entries;
drop table if exists payroll_runs;

-- users.salary_amount -> daily_rate: this column now unambiguously means a flat per-day rate
-- (no more frequency concept), so it's renamed for clarity rather than left named generically.
alter table users rename column salary_amount to daily_rate;
alter table users drop column if exists salary_frequency;

-- list_users(): drop salary_frequency from the row output, rename salary_amount -> daily_rate.
-- Same signature as always (row-shape-only change).
create or replace function list_users(
  p_search text default null,
  p_role text default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_status text default null
)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select u.*
    from users u
    where
      (p_search is null or p_search = '' or
        u.username ilike '%' || p_search || '%' or
        u.first_name ilike '%' || p_search || '%' or
        u.last_name ilike '%' || p_search || '%')
      and (p_role is null or p_role = '' or u.role = p_role)
      and (p_status is null or p_status = '' or u.status = p_status)
  ),
  sorted as (
    select
      f.*,
      case p_sort_by
        when 'name' then f.first_name || ' ' || f.last_name
        when 'username' then f.username
        when 'role' then f.role
      end as sort_text
    from filtered f
  ),
  paged as (
    select *
    from sorted
    order by
      case when p_sort_dir = 'asc' then sort_text end asc,
      case when p_sort_dir = 'desc' then sort_text end desc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then created_at end desc,
      created_at desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'username', p.username,
        'role', p.role,
        'permissions', p.permissions,
        'avatar', p.avatar,
        'status', p.status,
        'commission_rate', p.commission_rate,
        'daily_rate', p.daily_rate,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;

-- list_expenses(): drop payroll_run_id from the row output (commission_order_ids stays --
-- Commission release is untouched by this cleanup). Same signature.
create or replace function list_expenses(
  p_search text default null,
  p_category text default null,
  p_payment_method text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_created_by uuid default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'date',
  p_sort_dir text default 'desc'
)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select e.*
    from expenses e
    where
      (p_search is null or p_search = '' or
        e.notes ilike '%' || p_search || '%' or
        e.category ilike '%' || p_search || '%')
      and (p_category is null or p_category = '' or e.category = p_category)
      and (p_payment_method is null or p_payment_method = '' or e.payment_method = p_payment_method)
      and (p_date_from is null or e.date >= p_date_from)
      and (p_date_to is null or e.date <= p_date_to)
      and (p_created_by is null or e.created_by = p_created_by)
  ),
  sorted as (
    select
      f.*,
      case p_sort_by when 'category' then f.category end as sort_text,
      case p_sort_by when 'amount' then f.amount end as sort_num
    from filtered f
  ),
  paged as (
    select *
    from sorted
    order by
      case when p_sort_dir = 'asc' then sort_text end asc,
      case when p_sort_dir = 'desc' then sort_text end desc,
      case when p_sort_dir = 'asc' then sort_num end asc,
      case when p_sort_dir = 'desc' then sort_num end desc,
      case when p_sort_by = 'date' and p_sort_dir = 'asc' then date end asc,
      case when p_sort_by = 'date' and p_sort_dir = 'desc' then date end desc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then created_at end desc,
      date desc,
      created_at desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'date', p.date,
        'amount', p.amount,
        'category', p.category,
        'payment_method', p.payment_method,
        'notes', p.notes,
        'created_by', p.created_by,
        'created_by_name', coalesce(nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), ''),
        'recurring_expense_id', p.recurring_expense_id,
        'commission_order_ids', p.commission_order_ids,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_dir = 'asc' then p.sort_num end asc,
        case when p_sort_dir = 'desc' then p.sort_num end desc,
        case when p_sort_by = 'date' and p_sort_dir = 'asc' then p.date end asc,
        case when p_sort_by = 'date' and p_sort_dir = 'desc' then p.date end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.date desc,
        p.created_at desc)
      from paged p
      left join users u on u.id = p.created_by
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;
