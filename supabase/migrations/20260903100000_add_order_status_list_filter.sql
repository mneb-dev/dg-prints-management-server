-- Allow filtering orders by multiple statuses at once (e.g. the dashboard's "In production"
-- link, which spans layout/trace/print/cut/pack). p_status changes from a scalar text to a
-- text[] — that's a different function signature, so the old exact overload must be dropped
-- explicitly or it lingers alongside this one.
drop function if exists list_orders(text, text, text, text, timestamptz, timestamptz, int, int, text, text);

create or replace function list_orders(
  p_search text default null,
  p_category text default null,
  p_status text[] default null,
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
      and (p_status is null or array_length(p_status, 1) is null or o.status = any(p_status))
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
        'layout_fee', p.layout_fee,
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
      left join users cu on cu.id = p.created_by
      left join users su on su.id = p.status_updated_by
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;
