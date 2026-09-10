-- Per-user commission rate (%) applied to an order's layout_fee when attributing commission to
-- that order's layout_by user (see commission_summary() in
-- 20260910150000_add_commission_summary.sql). Applied live at read time, never snapshotted onto
-- orders — changing a user's rate retroactively changes their historical commission totals, same
-- as layout_by_name being resolved live via join rather than stored.
alter table users add column if not exists commission_rate numeric(5,2) not null default 100
  check (commission_rate >= 0 and commission_rate <= 100);

-- list_users(): return commission_rate alongside the other user fields. Parameter list is
-- unchanged (no new filter), so this is a pure row-shape addition — see
-- 20260902080000_add_user_status.sql's comment for why `create or replace function` requires the
-- existing parameter list/order to stay intact.
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
