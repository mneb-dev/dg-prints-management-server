-- Expense tracking: one-off expenses plus admin/superadmin-managed recurring
-- schedules that materialize into real expense rows via a Vercel Cron job
-- calling process_recurring_expenses() (see src/routes/internal.ts).

create table if not exists recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10, 2) not null check (amount > 0),
  category text not null,
  payment_method text not null,
  notes text not null default '',
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  start_date date not null,
  next_run_date date not null,
  active boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurring_expenses_due_idx
  on recurring_expenses (next_run_date)
  where active;

alter table recurring_expenses enable row level security;
-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

drop trigger if exists recurring_expenses_set_updated_at on recurring_expenses;
create trigger recurring_expenses_set_updated_at
  before update on recurring_expenses
  for each row
  execute function set_updated_at();

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric(10, 2) not null check (amount > 0),
  category text not null,
  payment_method text not null,
  notes text not null default '',
  created_by uuid references users (id) on delete set null,
  recurring_expense_id uuid references recurring_expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_created_by_idx on expenses (created_by);
create index if not exists expenses_date_idx on expenses (date);

alter table expenses enable row level security;
-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

drop trigger if exists expenses_set_updated_at on expenses;
create trigger expenses_set_updated_at
  before update on expenses
  for each row
  execute function set_updated_at();

-- Paginated/search listing, matching the list_orders/list_products shape:
-- returns { rows: [...], total: N } from one query. created_by_name is
-- resolved live via a join (no denormalized name column), so a renamed
-- user's history stays accurate instead of showing a stale snapshot.
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

-- Called by GET /internal/process-recurring-expenses (Vercel Cron, daily).
-- For every active schedule that's due, generates one expenses row per
-- missed occurrence (catching up if a run was skipped) and advances
-- next_run_date past today. Paused (active = false) schedules are skipped
-- entirely, so pausing takes effect immediately with no extra cron logic.
create or replace function process_recurring_expenses()
returns integer
language plpgsql
as $$
declare
  schedule record;
  run_date date;
  generated_count integer := 0;
begin
  for schedule in
    select *
    from recurring_expenses
    where active and next_run_date <= current_date
    for update
  loop
    run_date := schedule.next_run_date;
    while run_date <= current_date loop
      insert into expenses (
        date, amount, category, payment_method, notes, created_by, recurring_expense_id
      )
      values (
        run_date, schedule.amount, schedule.category, schedule.payment_method,
        schedule.notes, schedule.created_by, schedule.id
      );
      generated_count := generated_count + 1;

      run_date := case schedule.frequency
        when 'daily' then (run_date + interval '1 day')::date
        when 'weekly' then (run_date + interval '7 days')::date
        when 'monthly' then (run_date + interval '1 month')::date
      end;
    end loop;

    update recurring_expenses
      set next_run_date = run_date
      where id = schedule.id;
  end loop;

  return generated_count;
end;
$$;
