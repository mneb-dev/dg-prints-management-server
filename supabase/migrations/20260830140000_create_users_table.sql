-- User accounts: authentication + role/permission-based access control.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  username text not null,
  password_hash text not null,
  role text not null default 'staff' check (role in ('staff', 'admin', 'superadmin')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_username_key on users (lower(username));

alter table users enable row level security;

-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

-- set_updated_at() is already defined in 20260828193329_create_product_tables.sql.
drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
  before update on users
  for each row
  execute function set_updated_at();

-- Paginated/search listing, matching the list_products/list_orders shape:
-- returns { rows: [...], total: N } from one query. password_hash is
-- intentionally never selected here, so it can never leak through this path.
create or replace function list_users(
  p_search text default null,
  p_role text default null,
  p_limit int default 10,
  p_offset int default 0
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
  ),
  paged as (
    select *
    from filtered
    order by created_at desc
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
        'created_at', p.created_at,
        'updated_at', p.updated_at
      ) order by p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;
