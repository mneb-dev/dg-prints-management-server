-- User-controlled sorting for list_products/list_orders/list_users.
--
-- These are `language sql` functions, so a sort column can't be a plain
-- interpolated identifier (SQL doesn't parameterize identifiers, and using
-- dynamic EXECUTE/format() would reopen an injection surface). Instead each
-- function computes one "sort_text" column (and, for orders, a "sort_num"
-- column) inside the `paged` CTE via a `case p_sort_by when ...` — only the
-- branch matching the requested field is ever non-null, so it acts as that
-- field's value with its native type preserved (numeric/timestamp
-- comparisons stay correct, unlike casting everything to text). The
-- direction-aware `order by` pairs (`case when p_sort_dir = 'asc' then
-- sort_text end asc, case when p_sort_dir = 'desc' then sort_text end
-- desc, ...`) are reused verbatim in the outer `jsonb_agg(... order by ...)`
-- so the JSON array order matches the page that was actually selected.
-- created_at desc is always the final tiebreaker. An unrecognized p_sort_by
-- simply matches no case branch and falls through to that tiebreaker.
--
-- sort_text/sort_num are computed in a `sorted` CTE and only ordered on in
-- the next `paged` CTE: Postgres only lets an ORDER BY reference an output
-- column alias as a bare name, not nested inside another expression, so
-- `case when p_sort_dir = 'asc' then sort_text end` fails if sort_text is
-- aliased in that same select. Once `sorted` materializes the column, `paged`
-- selects it as a real input column and can freely wrap it in `case`.

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
  with filtered as (
    select pr.*
    from products pr
    where
      (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%')
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
  ),
  sorted as (
    select
      f.*,
      case p_sort_by
        when 'name' then f.name
        when 'category' then f.category
        when 'status' then f.status
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
        'name', p.name,
        'category', p.category,
        'description', p.description,
        'status', p.status,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', po.id,
            'name', po.name,
            'required', po.required,
            'sort_order', po.sort_order,
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
            'id', pp.id,
            'applies_to', pp.applies_to,
            'pricing_type', pp.pricing_type,
            'package_name', pp.package_name,
            'price', pp.price,
            'unit', pp.unit,
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
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;

create or replace function list_orders(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_payment_status text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select o.*
    from orders o
    where
      (p_search is null or p_search = '' or
        o.order_number ilike '%' || p_search || '%' or
        o.customer_name ilike '%' || p_search || '%' or
        o.description ilike '%' || p_search || '%')
      and (p_status is null or p_status = '' or o.status = p_status)
      and (p_payment_status is null or p_payment_status = '' or o.payment_status = p_payment_status)
      and (p_date_from is null or o.created_at >= p_date_from)
      and (p_date_to is null or o.created_at <= p_date_to)
      and (
        p_category is null or p_category = '' or exists (
          select 1 from order_items oi
          where oi.order_id = o.id and oi.product_category = p_category
        )
      )
  ),
  sorted as (
    select
      f.*,
      case p_sort_by
        when 'order_number' then f.order_number
        when 'customer_name' then f.customer_name
      end as sort_text,
      case p_sort_by
        when 'total' then f.total
      end as sort_num
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
      case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
      case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then created_at end desc,
      created_at desc
    limit p_limit offset p_offset
  )
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
        'description', p.description,
        'channel', p.channel,
        'additional_fees', p.additional_fees,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'shipping_address', p.shipping_address,
        'payment_status', p.payment_status,
        'payment_method', p.payment_method,
        'payment_down_payment', p.payment_down_payment,
        'payment_balance', p.payment_balance,
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
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;

create or replace function list_users(
  p_search text default null,
  p_role text default null,
  p_limit int default 10,
  p_offset int default 0,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
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
