-- Orders get an "arranged" shipment flag, set/cleared from the portal's Arrange shipment
-- dialog once the SPX booking is made. It is independent of order status: arranged_at is the
-- timestamp it was marked (null = not arranged); there is no boolean column. upsert_order lists
-- its columns explicitly, so ordinary order edits leave the flag alone.
--
-- list_orders returns arranged_at and takes a new p_arranged filter (true = arranged, false = not
-- arranged, null = any); otherwise identical to
-- 20261019090000_list_orders_shipping_search_and_status_sort.sql. The old 13-arg signature is
-- dropped first so no overload is left behind.
--
-- Apply BEFORE deploying the server: its order select references orders.arranged_at.

alter table orders add column if not exists arranged_at timestamptz;

drop function if exists list_orders(text, text, text[], text, uuid, timestamptz, timestamptz, int, int, text, text, boolean, text);

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
  p_channel text default null,
  p_arranged boolean default null
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
        'arranged_at', p.arranged_at,
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
        case when p_sort_dir = 'asc' then p.sort_ts end asc,
        case when p_sort_dir = 'desc' then p.sort_ts end desc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'asc' then p.created_at end asc,
        case when p_sort_by = 'created_at' and p_sort_dir = 'desc' then p.created_at end desc,
        p.created_at desc)
      from (
        select * from (
          select
            o.*,
            case p_sort_by
              when 'customer_name' then o.customer_name
            end as sort_text,
            case p_sort_by
              when 'order_number' then (substring(o.order_number from '(\d+)$'))::numeric
              when 'total' then o.total
            end as sort_num,
            case p_sort_by
              when 'status_updated_at' then coalesce(o.status_updated_at, o.created_at)
            end as sort_ts
          from orders o
          where
            (p_search is null or p_search = '' or
              o.order_number ilike '%' || p_search || '%' or
              o.customer_name ilike '%' || p_search || '%' or
              o.notes ilike '%' || p_search || '%' or
              o.shipping_address->>'name' ilike '%' || p_search || '%' or
              (length(regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(63|0)', '')) >= 4 and
                regexp_replace(coalesce(o.shipping_address->>'phone', ''), '\D', '', 'g')
                  like '%' || regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(63|0)', '') || '%') or
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
            and (p_arranged is null or (o.arranged_at is not null) = p_arranged)
        ) f
        order by
          case when p_sort_dir = 'asc' then f.sort_text end asc,
          case when p_sort_dir = 'desc' then f.sort_text end desc,
          case when p_sort_dir = 'asc' then f.sort_num end asc,
          case when p_sort_dir = 'desc' then f.sort_num end desc,
          case when p_sort_dir = 'asc' then f.sort_ts end asc,
          case when p_sort_dir = 'desc' then f.sort_ts end desc,
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
          o.shipping_address->>'name' ilike '%' || p_search || '%' or
          (length(regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(63|0)', '')) >= 4 and
            regexp_replace(coalesce(o.shipping_address->>'phone', ''), '\D', '', 'g')
              like '%' || regexp_replace(regexp_replace(p_search, '\D', '', 'g'), '^(63|0)', '') || '%') or
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
        and (p_arranged is null or (o.arranged_at is not null) = p_arranged)
    )
  );
$$;
