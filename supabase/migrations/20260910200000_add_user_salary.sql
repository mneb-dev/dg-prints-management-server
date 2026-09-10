-- Fixed base salary/wage paid in addition to commission (see 20260910140000_add_user_commission_rate.sql
-- for the commission side, which stays a separate concept/module). Nullable -- most users may not
-- be salaried; commission-only staff simply leave this unset. salary_frequency is display/labeling
-- only in v1 (e.g. "PHP 15,000/month" shown on the user form and payroll run screen) -- it is NOT
-- used to prorate salary_amount across an arbitrary payroll run's date span. A new payroll run
-- always pre-fills a staff member's flat salary_amount regardless of the run's period length; the
-- admin adjusts it per run if a period is shorter/longer than the labeled frequency implies.
alter table users add column if not exists salary_amount numeric(10,2)
  check (salary_amount is null or salary_amount >= 0);
alter table users add column if not exists salary_frequency text
  check (salary_frequency is null or salary_frequency in ('daily', 'weekly', 'biweekly', 'monthly'));

-- list_users(): return salary_amount/salary_frequency alongside the other user fields, same
-- additive row-shape pattern as commission_rate's own addition. Parameter list unchanged.
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
        'salary_amount', p.salary_amount,
        'salary_frequency', p.salary_frequency,
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
