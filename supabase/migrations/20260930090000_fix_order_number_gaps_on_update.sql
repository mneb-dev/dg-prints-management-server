-- upsert_order used `insert ... on conflict (id) do update` for both creates
-- and edits. Postgres evaluates column defaults for the proposed row before
-- detecting the conflict, so every edit of an existing order still called
-- next_order_number() -> nextval() and burned a sequence value. That's why
-- order numbers skipped: each status/payment/item edit consumed one number.
--
-- Update first; only insert (and thus only draw an order number) when the
-- order doesn't exist yet.

create or replace function upsert_order(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid := (payload->>'id')::uuid;
  v_item_ids uuid[];
  itm jsonb;
begin
  update orders set
    customer_name = coalesce(payload->>'customer_name', ''),
    customer_phone = coalesce(payload->>'customer_phone', ''),
    status = coalesce(payload->>'status', 'pending'),
    subtotal = coalesce((payload->>'subtotal')::numeric, 0),
    discount = coalesce((payload->>'discount')::numeric, 0),
    total = coalesce((payload->>'total')::numeric, 0),
    notes = coalesce(payload->>'notes', ''),
    channel = coalesce(payload->>'channel', ''),
    additional_fees = coalesce((payload->>'additional_fees')::numeric, 0),
    layout_fee = coalesce((payload->>'layout_fee')::numeric, 0),
    layout_by = (payload->>'layout_by')::uuid,
    shipping_address = payload->'shipping_address',
    payment_status = coalesce(payload->>'payment_status', ''),
    payment_method = payload->>'payment_method',
    payment_down_payment = coalesce((payload->>'payment_down_payment')::numeric, 0),
    payment_balance = coalesce((payload->>'payment_balance')::numeric, 0),
    created_at = coalesce((payload->>'created_at')::timestamptz, now()),
    created_by = (payload->>'created_by')::uuid,
    status_updated_by = (payload->>'status_updated_by')::uuid,
    status_updated_at = (payload->>'status_updated_at')::timestamptz
  where id = v_order_id;

  if not found then
    insert into orders (
      id, customer_name, customer_phone, status, subtotal, discount, total,
      notes, channel, additional_fees, layout_fee, layout_by, shipping_address,
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
      coalesce(payload->>'channel', ''),
      coalesce((payload->>'additional_fees')::numeric, 0),
      coalesce((payload->>'layout_fee')::numeric, 0),
      (payload->>'layout_by')::uuid,
      payload->'shipping_address',
      coalesce(payload->>'payment_status', ''),
      payload->>'payment_method',
      coalesce((payload->>'payment_down_payment')::numeric, 0),
      coalesce((payload->>'payment_balance')::numeric, 0),
      coalesce((payload->>'created_at')::timestamptz, now()),
      (payload->>'created_by')::uuid,
      (payload->>'status_updated_by')::uuid,
      (payload->>'status_updated_at')::timestamptz
    );
  end if;

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
