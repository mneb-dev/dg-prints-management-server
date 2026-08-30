-- Server-side pagination/search/filter for order and product listing.
--
-- Both functions return a single jsonb value shaped { "rows": [...], "total": N }
-- rather than a `count(*) over()` window column, so a zero-match search still
-- reports an accurate total (a window column would return no rows at all in
-- that case, and thus no count either). Row shape in `rows` matches the
-- existing ORDER_SELECT/PRODUCT_SELECT embedded-select shape exactly
-- (snake_case, same nesting), so mapRowToOrder/mapRowToProduct in
-- orderStore.ts/productStore.ts need no changes.

create or replace function list_orders(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_payment_status text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit int default 10,
  p_offset int default 0
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
      ) order by p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;

create or replace function list_products(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_pricing_type text default null, -- 'Package' | 'Per Unit' | 'Fixed' | 'Manual' | null
  p_limit int default 10,           -- null = unbounded (used by the unpaginated catalog call)
  p_offset int default 0
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
      ) order by p.created_at desc)
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$$;
