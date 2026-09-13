-- list_orders/list_products/list_expenses/list_users all shared the same defect: the `filtered`
-- CTE was referenced twice (once via sorted/paged to build the page of rows, once for `total`).
-- A non-recursive CTE referenced more than once is materialized by Postgres before anything else
-- runs -- confirmed via EXPLAIN ANALYZE against the live schema: even a completely unfiltered
-- list_orders() call did a full `Seq Scan` materializing every column of every row in `orders`
-- BEFORE the ORDER BY + LIMIT was applied, making orders_created_at_idx/orders_status_created_at_
-- idx (and the equivalent indexes on other tables) useless no matter how well-indexed the filter/
-- sort columns were. This is what was causing Gateway Timeouts on GET /api/orders with no
-- filters at all -- the single most common request in the app.
--
-- Fix: each function below now runs two independent queries instead of one doubly-referenced
-- CTE -- a plain `where <predicate> order by ... limit ... offset ...` for the page of rows
-- (free to use an index scan + limit, since it's not entangled with anything else), and a
-- separate `count(*) where <predicate>` for the total (still a real scan -- unavoidable for an
-- exact count -- but no longer blocks the row-fetch path from using an index). The predicate is
-- necessarily duplicated between the two; row shape/sort/embed logic is otherwise unchanged.

create or replace function list_orders(
  p_search text default null,
  p_category text default null,
  p_status text[] default null,
  p_payment_status text default null,
  p_created_by uuid default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_has_or boolean default null,
  p_channel text default null
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'order_number', p.order_number,
        'customer_name', p.customer_name,
        'customer_phone', p.customer_phone,
        'status', p.status,
        'subtotal', p.subtotal,
        'discount', p.discount,
        'total', p.total,
        'notes', p.notes,
        'channel', p.channel,
        'additional_fees', p.additional_fees,
        'layout_fee', p.layout_fee,
        'layout_by', p.layout_by,
        'layout_by_name', coalesce(nullif(trim(coalesce(lu.first_name, '') || ' ' || coalesce(lu.last_name, '')), ''), ''),
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'created_by', p.created_by,
        'created_by_name', coalesce(nullif(trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')), ''), ''),
        'status_updated_by', p.status_updated_by,
        'status_updated_by_name', coalesce(nullif(trim(coalesce(su.first_name, '') || ' ' || coalesce(su.last_name, '')), ''), ''),
        'status_updated_at', p.status_updated_at,
        'shipping_address', p.shipping_address,
        'payment_status', p.payment_status,
        'payment_method', p.payment_method,
        'payment_down_payment', p.payment_down_payment,
        'payment_balance', p.payment_balance,
        'or_request', (
          select jsonb_build_object(
            'id', r.id, 'name', r.name, 'address', r.address,
            'tin', r.tin, 'invoice_number', r.invoice_number,
            'created_at', r.created_at, 'updated_at', r.updated_at
          )
          from order_or_requests r where r.order_id = p.id
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'product_name', oi.product_name,
            'product_category', oi.product_category,
            'selected_options', oi.selected_options,
            'quantity', oi.quantity,
            'notes', oi.notes,
            'pricing', oi.pricing,
            'line_total', oi.line_total,
            'sticker_quotation', oi.sticker_quotation,
            'sort_order', oi.sort_order
          ) order by oi.sort_order)
          from order_items oi where oi.order_id = p.id
        ), '[]'::jsonb)
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_dir = 'asc' then p.sort_num end asc,
        case when p_sort_dir = 'desc' then p.sort_num end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from (
        select * from (
          select
            o.*,
            case p_sort_by
              when 'order_number' then o.order_number
              when 'customer_name' then o.customer_name
            end as sort_text,
            case p_sort_by
              when 'total' then o.total
            end as sort_num
          from orders o
          where
            (p_search is null or p_search = '' or
              o.order_number ilike '%' || p_search || '%' or
              o.customer_name ilike '%' || p_search || '%' or
              o.notes ilike '%' || p_search || '%' or
              exists (
                select 1 from order_items oi
                where oi.order_id = o.id and oi.notes ilike '%' || p_search || '%'
              ))
            and (p_status is null or array_length(p_status, 1) is null or o.status = any(p_status))
            and (p_payment_status is null or p_payment_status = '' or o.payment_status = p_payment_status)
            and (p_created_by is null or o.created_by = p_created_by)
            and (p_date_from is null or o.created_at >= p_date_from)
            and (p_date_to is null or o.created_at <= p_date_to)
            and (
              p_category is null or p_category = '' or exists (
                select 1 from order_items oi
                where oi.order_id = o.id and oi.product_category = p_category
              )
            )
            and (p_channel is null or p_channel = '' or o.channel = p_channel)
            and (
              p_has_or is null or
              exists (select 1 from order_or_requests r where r.order_id = o.id) = p_has_or
            )
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_dir = 'asc' then f.sort_num end asc,
          case when p_sort_dir = 'desc' then f.sort_num end desc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then f.created_at end asc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then f.created_at end desc,
          f.created_at desc
        limit p_limit offset p_offset
      ) p
      left join users cu on cu.id = p.created_by
      left join users su on su.id = p.status_updated_by
      left join users lu on lu.id = p.layout_by
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from orders o
      where
        (p_search is null or p_search = '' or
          o.order_number ilike '%' || p_search || '%' or
          o.customer_name ilike '%' || p_search || '%' or
          o.notes ilike '%' || p_search || '%' or
          exists (
            select 1 from order_items oi
            where oi.order_id = o.id and oi.notes ilike '%' || p_search || '%'
          ))
        and (p_status is null or array_length(p_status, 1) is null or o.status = any(p_status))
        and (p_payment_status is null or p_payment_status = '' or o.payment_status = p_payment_status)
        and (p_created_by is null or o.created_by = p_created_by)
        and (p_date_from is null or o.created_at >= p_date_from)
        and (p_date_to is null or o.created_at <= p_date_to)
        and (
          p_category is null or p_category = '' or exists (
            select 1 from order_items oi
            where oi.order_id = o.id and oi.product_category = p_category
          )
        )
        and (p_channel is null or p_channel = '' or o.channel = p_channel)
        and (
          p_has_or is null or
          exists (select 1 from order_or_requests r where r.order_id = o.id) = p_has_or
        )
    )
  );
$$;

create or replace function list_products(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_pricing_type text default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'description', p.description,
        'status', p.status,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', po.id, 'name', po.name, 'required', po.required, 'sort_order', po.sort_order,
            'values', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pov.id, 'value', pov.value, 'sort_order', pov.sort_order
              ) order by pov.sort_order)
              from product_option_values pov where pov.option_id = po.id
            ), '[]'::jsonb)
          ) order by po.sort_order)
          from product_options po where po.product_id = p.id
        ), '[]'::jsonb),
        'pricing', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pp.id, 'applies_to', pp.applies_to, 'pricing_type', pp.pricing_type,
            'package_name', pp.package_name, 'price', pp.price, 'unit', pp.unit,
            'sort_order', pp.sort_order
          ) order by pp.sort_order)
          from product_pricing pp where pp.product_id = p.id
        ), '[]'::jsonb)
      ) order by
        case when p_sort_dir = 'asc' then p.sort_text end asc,
        case when p_sort_dir = 'desc' then p.sort_text end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from (
        select * from (
          select
            pr.*,
            case p_sort_by
              when 'name' then pr.name
              when 'category' then pr.category
              when 'status' then pr.status
            end as sort_text
          from products pr
          where
            pr.deleted_at is null
            and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
            and (p_category is null or p_category = '' or pr.category = p_category)
            and (p_status is null or p_status = '' or pr.status = p_status)
            and (
              p_pricing_type is null or p_pricing_type = '' or (
                case
                  when p_pricing_type = 'Manual' then
                    not exists (select 1 from product_pricing pp where pp.product_id = pr.id)
                  else
                    exists (
                      select 1 from product_pricing pp
                      where pp.product_id = pr.id and pp.pricing_type = p_pricing_type
                    )
                end
              )
            )
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then f.created_at end asc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then f.created_at end desc,
          f.created_at desc
        limit p_limit offset p_offset
      ) p
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from products pr
      where
        pr.deleted_at is null
        and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
        and (p_category is null or p_category = '' or pr.category = p_category)
        and (p_status is null or p_status = '' or pr.status = p_status)
        and (
          p_pricing_type is null or p_pricing_type = '' or (
            case
              when p_pricing_type = 'Manual' then
                not exists (select 1 from product_pricing pp where pp.product_id = pr.id)
              else
                exists (
                  select 1 from product_pricing pp
                  where pp.product_id = pr.id and pp.pricing_type = p_pricing_type
                )
            end
          )
        )
    )
  );
$$;

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
        'monthly_incentive_release_id', p.monthly_incentive_release_id,
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
      from (
        select * from (
          select
            e.*,
            case p_sort_by when 'category' then e.category end as sort_text,
            case p_sort_by when 'amount' then e.amount end as sort_num
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
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_dir = 'asc' then f.sort_num end asc,
          case when p_sort_dir = 'desc' then f.sort_num end desc,
          case when p_sort_by = 'date' and p_sort_dir = 'asc' then f.date end asc,
          case when p_sort_by = 'date' and p_sort_dir = 'desc' then f.date end desc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then f.created_at end asc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then f.created_at end desc,
          f.date desc,
          f.created_at desc
        limit p_limit offset p_offset
      ) p
      left join users u on u.id = p.created_by
    ), '[]'::jsonb),
    'total', (
      select count(*)
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
    )
  );
$$;

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
      from (
        select * from (
          select
            u.*,
            case p_sort_by
              when 'name' then u.first_name || ' ' || u.last_name
              when 'username' then u.username
              when 'role' then u.role
            end as sort_text
          from users u
          where
            (p_search is null or p_search = '' or
              u.username ilike '%' || p_search || '%' or
              u.first_name ilike '%' || p_search || '%' or
              u.last_name ilike '%' || p_search || '%')
            and (p_role is null or p_role = '' or u.role = p_role)
            and (p_status is null or p_status = '' or u.status = p_status)
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then f.created_at end asc,
          case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then f.created_at end desc,
          f.created_at desc
        limit p_limit offset p_offset
      ) p
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from users u
      where
        (p_search is null or p_search = '' or
          u.username ilike '%' || p_search || '%' or
          u.first_name ilike '%' || p_search || '%' or
          u.last_name ilike '%' || p_search || '%')
        and (p_role is null or p_role = '' or u.role = p_role)
        and (p_status is null or p_status = '' or u.status = p_status)
    )
  );
$$;
