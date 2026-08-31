-- Allow admin/superadmin manual edits to override an order's created_at.
-- Previously created_at was fully DB-default (set once on insert, never
-- touched by upsert_order's ON CONFLICT UPDATE). Role enforcement lives in
-- the application layer (src/routes/orders.ts); this migration only makes
-- the column updatable through the RPC when the caller supplies it.

create or replace function upsert_order(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid := (payload->>'id')::uuid;
  v_item_ids uuid[];
  itm jsonb;
begin
  insert into orders (
    id, customer_name, customer_phone, status, subtotal, discount, total,
    notes, description, channel, additional_fees, layout_fee, shipping_address,
    payment_status, payment_method, payment_down_payment, payment_balance,
    created_at, created_by, status_updated_by, status_updated_at
  )
  values (
    v_order_id,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    coalesce(payload->>'status', 'pending'),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'discount')::numeric, 0),
    coalesce((payload->>'total')::numeric, 0),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'channel', ''),
    coalesce((payload->>'additional_fees')::numeric, 0),
    coalesce((payload->>'layout_fee')::numeric, 0),
    payload->'shipping_address',
    coalesce(payload->>'payment_status', ''),
    payload->>'payment_method',
    coalesce((payload->>'payment_down_payment')::numeric, 0),
    coalesce((payload->>'payment_balance')::numeric, 0),
    coalesce((payload->>'created_at')::timestamptz, now()),
    (payload->>'created_by')::uuid,
    (payload->>'status_updated_by')::uuid,
    (payload->>'status_updated_at')::timestamptz
  )
  on conflict (id) do update set
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    status = excluded.status,
    subtotal = excluded.subtotal,
    discount = excluded.discount,
    total = excluded.total,
    notes = excluded.notes,
    description = excluded.description,
    channel = excluded.channel,
    additional_fees = excluded.additional_fees,
    layout_fee = excluded.layout_fee,
    shipping_address = excluded.shipping_address,
    payment_status = excluded.payment_status,
    payment_method = excluded.payment_method,
    payment_down_payment = excluded.payment_down_payment,
    payment_balance = excluded.payment_balance,
    created_at = excluded.created_at,
    created_by = excluded.created_by,
    status_updated_by = excluded.status_updated_by,
    status_updated_at = excluded.status_updated_at;

  select coalesce(array_agg((i->>'id')::uuid), '{}')
    into v_item_ids
    from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) i;

  delete from order_items
   where order_id = v_order_id
     and id != all (v_item_ids);

  for itm in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into order_items (
      id, order_id, product_id, product_name, product_category,
      selected_options, quantity, notes, pricing, line_total,
      sticker_quotation, sort_order
    )
    values (
      (itm->>'id')::uuid,
      v_order_id,
      (itm->>'product_id')::uuid,
      coalesce(itm->>'product_name', ''),
      coalesce(itm->>'product_category', ''),
      coalesce(itm->'selected_options', '[]'::jsonb),
      coalesce((itm->>'quantity')::int, 1),
      coalesce(itm->>'notes', ''),
      coalesce(itm->'pricing', '{}'::jsonb),
      coalesce((itm->>'line_total')::numeric, 0),
      itm->'sticker_quotation',
      coalesce((itm->>'sort_order')::int, 0)
    )
    on conflict (id) do update set
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      product_category = excluded.product_category,
      selected_options = excluded.selected_options,
      quantity = excluded.quantity,
      notes = excluded.notes,
      pricing = excluded.pricing,
      line_total = excluded.line_total,
      sticker_quotation = excluded.sticker_quotation,
      sort_order = excluded.sort_order;
  end loop;

  return v_order_id;
end;
$$;
